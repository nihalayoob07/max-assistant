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
            .put("fullScreen", if (Build.VERSION.SDK_INT >= 34) nm.canUseFullScreenIntent() else true)
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
            "fullScreen" -> if (Build.VERSION.SDK_INT >= 34) act.open(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg))
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
}
