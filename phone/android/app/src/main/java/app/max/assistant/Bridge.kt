package app.max.assistant

import android.Manifest
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.webkit.JavascriptInterface
import org.json.JSONObject
import kotlin.concurrent.thread

/** `window.Android` for the web UI. Server calls run on a thread and answer through window.__apiDone. */
class Bridge(private val act: MainActivity) {
    private val ctx get() = act.applicationContext

    @JavascriptInterface
    fun api(id: Int, method: String, path: String, body: String) {
        thread {
            val timeout = if (path == "/chat" || path == "/lead") 360_000 else 60_000
            val r = runCatching { Api.call(ctx, method, path, body.ifEmpty { null }, timeout) }
            val payload = r.getOrElse { JSONObject().put("error", it.message ?: "failed").toString() }
            act.js("window.__apiDone($id, ${r.isSuccess}, ${JSONObject.quote(payload)})")
        }
    }

    @JavascriptInterface
    fun permissions(): String {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val pm = ctx.getSystemService(PowerManager::class.java)
        return JSONObject()
            .put("mic", ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
            .put("notifications", nm.areNotificationsEnabled())
            // The call screen also needs "display over other apps": without it Android 10+ (and vivo) blocks opening it from the background.
            .put("fullScreen", (Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent()) && Settings.canDrawOverlays(ctx))
            .put("battery", pm.isIgnoringBatteryOptimizations(ctx.packageName))
            .put("speech", SpeechRecognizer.isRecognitionAvailable(ctx))
            .put("push", Push.configured(ctx))
            .put("registered", ctx.getSharedPreferences("max", Context.MODE_PRIVATE).getBoolean("registered", false))
            .put("vivo", Build.MANUFACTURER.lowercase() in listOf("vivo", "iqoo"))
            .put("android", Build.VERSION.RELEASE)
            .toString()
    }

    @JavascriptInterface
    fun request(what: String) {
        val pkg = Uri.parse("package:${ctx.packageName}")
        when (what) {
            "mic" -> act.runOnUiThread { act.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1) }
            "notifications" ->
                if (Build.VERSION.SDK_INT >= 33) act.runOnUiThread { act.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2) }
                else act.open(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName))
            "fullScreen" ->
                if (!Settings.canDrawOverlays(ctx)) act.open(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkg))
                else if (Build.VERSION.SDK_INT >= 34) act.open(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg))
            // Sideloaded, so the direct "let it run in the background" prompt is fine (Play would object).
            "battery" -> act.open(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg))
            "autostart" -> first(
                "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
                "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager",
                "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity",
            )
            "bgpower" -> first(
                "com.vivo.abe" to "com.vivo.applicationbehaviorengine.ui.ExcessivePowerManagerActivity",
                "com.iqoo.powersaving" to "com.iqoo.powersaving.PowerSavingManagerActivity",
                fallback = Intent(Intent.ACTION_POWER_USAGE_SUMMARY),
            )
            "lockscreen" -> first(
                "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.SoftPermissionDetailActivity",
                "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.PurviewTabActivity",
            )
            "speech" -> first(
                "com.google.android.googlequicksearchbox" to "com.google.android.voicesearch.greco3.languagepack.InstallActivity",
                fallback = Intent(Settings.ACTION_VOICE_INPUT_SETTINGS),
            )
        }
    }

    /** The first of the maker's settings pages that exists on this phone, else [fallback] / the app's own page. */
    private fun first(vararg pages: Pair<String, String>, fallback: Intent? = null) = act.runOnUiThread {
        for ((p, c) in pages) {
            val i = Intent().setComponent(ComponentName(p, c)).putExtra("packagename", ctx.packageName)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (runCatching { act.startActivity(i) }.isSuccess) return@runOnUiThread
        }
        act.open(fallback ?: Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}")))
    }

    /** Rings this phone after [sec] seconds without the server or Firebase (lock the screen to see the real thing). */
    @JavascriptInterface
    fun testCall(id: String, sec: Int) {
        if (!CallService.ID.matches(id)) return
        Handler(Looper.getMainLooper()).postDelayed({ CallService.ring(ctx, id) }, sec.coerceIn(0, 60) * 1000L)
    }

    @JavascriptInterface
    fun register() = Push.register(ctx)

    /** The owner calls Max: no ringing, straight into a conversation with main Max. */
    @JavascriptInterface
    fun callMax() = CallService.dial(ctx)

    // ---------- Remote: this phone as the microphone for Max on the laptop ----------
    // Google's recogniser hears it here (better than Whisper on the laptop); the web UI sends the words on (POST /remote).
    // Events go to window.__remote(kind, text): ready, hearing, partial, final, error.
    private var rec: SpeechRecognizer? = null
    private var offline = true   // the offline English pack when there is one; dropped if this phone can't

    private fun remote(kind: String, text: String = ""): Unit = act.js("window.__remote && window.__remote(${JSONObject.quote(kind)}, ${JSONObject.quote(text)})")

    @JavascriptInterface
    fun remoteListen(): Unit = act.runOnUiThread {
        if (ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            act.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 7)
            remote("error", "Allow the microphone, then tap the mic again")
            return@runOnUiThread
        }
        rec?.destroy()
        rec = SpeechRecognizer.createSpeechRecognizer(act).apply {
            setRecognitionListener(object : RecognitionListener {
                fun first(b: Bundle?) = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                override fun onReadyForSpeech(p: Bundle?) = remote("ready")
                override fun onBeginningOfSpeech() = remote("hearing")
                override fun onPartialResults(b: Bundle?) { first(b).takeIf { it.isNotBlank() }?.let { remote("partial", it) } }
                override fun onResults(b: Bundle?) = remote("final", first(b))
                override fun onError(error: Int) {
                    if (offline && error !in listOf(SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT)) { offline = false; remoteListen(); return }
                    remote("error", if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) "Didn't catch that. Tap the mic and try again" else "The mic stopped (error $error). Tap to try again")
                }
                override fun onRmsChanged(v: Float) {}
                override fun onBufferReceived(b: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onEvent(t: Int, b: Bundle?) {}
            })
            startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN")
                .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, offline)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.packageName))
        }
    }

    @JavascriptInterface
    fun remoteStop() = act.runOnUiThread { rec?.destroy(); rec = null }
}
