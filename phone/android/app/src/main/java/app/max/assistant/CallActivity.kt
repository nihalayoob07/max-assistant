package app.max.assistant

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.media.AudioAttributes
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject
import java.util.Locale
import kotlin.concurrent.thread

/** The call: rings, then Max reads out the deal (TextToSpeech), listens (SpeechRecognizer), repeats back what it
 *  understood, and only acts on a "yes". The buttons do the same without talking. */
class CallActivity : Activity() {

    private val bg = Color.parseColor("#010507")
    private val cyan = Color.parseColor("#38DBE6")
    private val amber = Color.parseColor("#FF8A1E")
    private val red = Color.parseColor("#FF3B4E")
    private val ink = Color.parseColor("#E2F9FB")
    private val muted = Color.parseColor("#6F9BA3")
    private val condensed = Typeface.create("sans-serif-condensed", Typeface.BOLD)
    private val mono = Typeface.MONOSPACE

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var status: TextView
    private lateinit var title: TextView
    private lateinit var prices: TextView
    private lateinit var log: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var ringRow: LinearLayout
    private lateinit var dealRow: LinearLayout
    private lateinit var callRow: LinearLayout
    private lateinit var speakerBtn: Button

    private var id = ""
    private var deal: JSONObject? = null   // what this call is about (server: GET /call)
    private val talking get() = id.startsWith("brief:") || id.startsWith("E")   // after Max speaks, a conversation with Max
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var ttsInit = false        // the engine answered (ready or not)
    private var recognizer: SpeechRecognizer? = null
    private var offline = true          // prefer the offline English pack; dropped if this phone doesn't have it
    private var answered = false
    private var busy = false            // a decision is being written: no more listening
    private var pending: JSONObject? = null   // a decision Max read back, waiting for "yes"
    private var misses = 0
    private var speaker = false
    private val audio by lazy { getSystemService(AudioManager::class.java) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        id = CallService.id ?: run { finish(); return }
        build()
        thread { load() }   // fetch the deal while it rings, so answering is instant
        if (intent.getBooleanExtra("answer", false)) answer()
        handler.post(watch)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra("answer", false) && !answered) answer()
    }

    /** Declined from the notification, or the ring timed out: close. */
    private val watch = object : Runnable {
        override fun run() {
            if (CallService.id == null && !busy) { finish(); return }
            handler.postDelayed(this, 700)
        }
    }

    // ---------- the conversation ----------
    private fun load() {
        runCatching { JSONObject(Api.call(this, "GET", "/call?id=" + java.net.URLEncoder.encode(id, "UTF-8"))) }
            .onSuccess { d -> runOnUiThread { deal = d; showCall(d); if (answered && !ttsStarted) begin() } }
            .onFailure { e -> runOnUiThread { status.text = "CAN'T REACH THE SERVER"; line("Max", "I can't get this call's details (${e.message}). It's on Telegram too.") } }
    }
    private var ttsStarted = false

    private fun answer() {
        answered = true
        CallService.answer(this)
        ringRow.visibility = View.GONE
        callRow.visibility = View.VISIBLE
        status.text = "CONNECTING"
        audio.mode = AudioManager.MODE_IN_COMMUNICATION
        audio.isSpeakerphoneOn = speaker
        tts = TextToSpeech(this) { ok ->
            ttsReady = ok == TextToSpeech.SUCCESS
            ttsInit = true
            tts?.let { pickVoice(it) }
            tts?.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            if (deal != null && !ttsStarted) begin()
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1)
    }

    private fun begin() {
        if (!ttsInit) return   // the TTS engine's callback calls back here
        ttsStarted = true
        if ((deal?.optJSONArray("buttons")?.length() ?: 0) > 0) dealRow.visibility = View.VISIBLE
        say(deal?.optString("say") ?: "") { listen() }
    }

    /** Max's desktop voice is a British man (Kokoro "George"): the closest the phone has is an en-GB male voice. */
    private fun pickVoice(t: TextToSpeech) {
        val gb = runCatching { t.voices }.getOrNull().orEmpty().filter { it.locale.language == "en" && it.locale.country == "GB" && !it.isNetworkConnectionRequired }
        val male = listOf("rjs", "gbd", "gbb").firstNotNullOfOrNull { n -> gb.find { it.name.contains("-x-$n") } }
        Log.i("MaxCall", "voices en-GB: ${gb.map { it.name }} -> ${male?.name}")
        if (male != null) t.voice = male else t.language = Locale.UK
        t.setPitch(0.9f)
    }

    private fun say(text: String, then: (() -> Unit)? = null) {
        line("Max", text)
        status.text = "MAX IS SPEAKING"
        val t = tts
        if (t == null || !ttsReady) { handler.postDelayed({ then?.invoke() }, 1500); return }
        val id = System.nanoTime().toString()
        t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(u: String?) {}
            override fun onDone(u: String?) { if (u == id) runOnUiThread { then?.invoke() } }
            @Deprecated("old API") override fun onError(u: String?) { if (u == id) runOnUiThread { then?.invoke() } }
        })
        audio.mode = AudioManager.MODE_IN_COMMUNICATION
        audio.isSpeakerphoneOn = speaker
        t.speak(text.replace("₹", "rupees "), TextToSpeech.QUEUE_FLUSH, null, id)
    }

    private fun listen() {
        if (busy || isFinishing) return
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED || !SpeechRecognizer.isRecognitionAvailable(this)) {
            status.text = "USE THE BUTTONS"
            return
        }
        status.text = if (pending != null) "SAY YES OR NO" else "LISTENING…"
        audio.mode = AudioManager.MODE_NORMAL   // Google's recognizer hears silence in call mode
        recognizer?.destroy()
        recognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
            setRecognitionListener(object : RecognitionListener {
                override fun onResults(b: Bundle) {
                    val said = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                    Log.i("MaxCall", "heard: $said")
                    if (said.isBlank()) missed(0) else heard(said)
                }
                override fun onError(error: Int) {
                    Log.i("MaxCall", "recognizer error $error")
                    // No offline pack (or it can't do en-IN): ask the online recognizer instead, straight away.
                    if (offline && error !in listOf(SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT)) { offline = false; listen(); return }
                    missed(error)
                }
                override fun onReadyForSpeech(p: Bundle?) {}
                override fun onBeginningOfSpeech() { status.text = "HEARING YOU…" }
                override fun onRmsChanged(v: Float) {}
                override fun onBufferReceived(b: ByteArray?) {}
                override fun onEndOfSpeech() { status.text = "THINKING…" }
                override fun onPartialResults(b: Bundle?) {}
                override fun onEvent(t: Int, b: Bundle?) {}
            })
            startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN")
                .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, offline)
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName))
        }
    }

    private fun missed(code: Int) {
        if (busy || isFinishing) return
        line("·", "didn't catch that (code $code)")
        if (talking && misses >= 1) { say("Okay, talk later. Bye.") { hangUp() }; return }
        if (++misses > 2) { status.text = "TAP TALK OR USE THE BUTTONS"; return }
        say(if (talking) "Anything else? Just say it, or say bye." else "Sorry, I didn't hear you.") { listen() }
    }

    private val yes = Regex("\\b(yes|yeah|yep|yup|right|correct|confirm|do it|go ahead|sure|ok|okay|haan)\\b", RegexOption.IGNORE_CASE)
    private val no = Regex("\\b(no|nope|nah|wait|cancel|wrong|don't|stop)\\b", RegexOption.IGNORE_CASE)

    private fun heard(text: String) {
        misses = 0
        line("You", text)
        val p = pending
        if (p != null) {
            val numbers = text.any { it.isDigit() }
            if (yes.containsMatchIn(text) && !no.containsMatchIn(text) && !numbers) { pending = null; decide(p); return }
            if (no.containsMatchIn(text) && !numbers) { pending = null; say("Okay. What should I tell them instead?") { listen() }; return }
            pending = null   // they said something new: treat it as the answer
        }
        if (talking && Regex("\\b(bye|that's all|that is all|nothing|no thanks|i'm good|all good)\\b",RegexOption.IGNORE_CASE).containsMatchIn(text)) {
            say("Okay. Bye.") { hangUp() }; return
        }
        status.text = "THINKING…"
        if (talking) say("One moment.")   // Max may take a while: the answer comes from main Max
        thread {
            val r = runCatching { JSONObject(Api.call(this, "POST", "/call/answer", JSONObject().put("id", id).put("text", text).toString(), 240_000)) }
            runOnUiThread {
                r.onSuccess { j ->
                    pending = j.optJSONObject("decision")
                    say(j.optString("say")) { listen() }
                }.onFailure { e -> say("I couldn't reach the server: ${e.message}") { listen() } }
            }
        }
    }

    /** The confirmed decision goes to the same owner path as the desktop card and Telegram's buttons. */
    private fun decide(d: JSONObject) {
        busy = true
        recognizer?.cancel()
        dealRow.visibility = View.GONE
        say("On it, this takes a few seconds.")
        status.text = "WORKING ON IT…"
        thread {
            val r = runCatching { JSONObject(Api.call(this, "POST", "/call/decide", JSONObject(d.toString()).put("id", id).toString(), 240_000)) }
            runOnUiThread {
                r.onSuccess { j ->
                    if (!j.optBoolean("ok")) { busy = false; dealRow.visibility = View.VISIBLE; say(j.optString("say")) { listen() }; return@onSuccess }
                    say(j.optString("say") + " Bye for now.") { hangUp() }
                }.onFailure { e -> busy = false; dealRow.visibility = View.VISIBLE; say("That didn't go through: ${e.message}. Try again, or use Telegram.") { listen() } }
            }
        }
    }

    private fun hangUp() {
        busy = false
        CallService.end(this)
        finish()
    }

    // ---------- screen ----------
    /** The call's title, details and answer buttons all come from the server (phone-api.js callInfo). */
    private fun showCall(d: JSONObject) {
        title.text = d.optString("title") + "\n" + d.optString("sub")
        prices.text = d.optString("info").replace(" · ", "   ·   ")
        dealRow.removeAllViews()
        val buttons = d.optJSONArray("buttons") ?: return
        for (i in 0 until buttons.length()) {
            val b = buttons.getJSONObject(i)
            val (color, filled) = when (b.optString("style")) { "primary" -> cyan to true; "danger" -> red to false; else -> amber to false }
            dealRow.addView(button(b.optString("label"), color, filled) { decide(b.getJSONObject("decision")) }, weight())
        }
    }

    private fun build() {
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(22), dp(30), dp(22), dp(22)) }
        col.addView(text("INCOMING · PRIVATE BUSINESS SYSTEM", 12f, muted, mono).apply { letterSpacing = 0.12f })
        col.addView(text("MAX", 64f, cyan, condensed).apply { letterSpacing = 0.4f; setShadowLayer(18f, 0f, 0f, Color.argb(130, 56, 219, 230)) })
        title = text(CallService.label(id).uppercase(Locale.US), 18f, ink, condensed)
        col.addView(title)
        prices = text("", 12f, amber, mono).apply { setPadding(0, dp(10), 0, dp(6)) }
        col.addView(prices)
        status = text("CALLING YOU…", 14f, cyan, mono).apply { letterSpacing = 0.1f; setPadding(0, dp(10), 0, dp(10)) }
        col.addView(status)
        log = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        scroll = ScrollView(this).apply { addView(log); isFillViewport = true }
        col.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))

        dealRow = row().apply { visibility = View.GONE }
        col.addView(dealRow)
        callRow = row().apply { visibility = View.GONE }
        speakerBtn = button("SPEAKER", cyan, false) { toggleSpeaker() }
        callRow.addView(speakerBtn, weight())
        callRow.addView(button("TALK", cyan, false) { misses = 0; if (!busy) { tts?.stop(); pending = null; listen() } }, weight())
        callRow.addView(button("HANG UP", red, true) { hangUp() }, weight())
        col.addView(callRow)
        ringRow = row()
        ringRow.addView(button("DECLINE", red, true) { hangUp() }, weight())
        ringRow.addView(button("ANSWER", cyan, true) { answer() }, weight())
        col.addView(ringRow)

        col.setBackgroundColor(bg)
        window.statusBarColor = bg
        window.navigationBarColor = bg
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
            col.setOnApplyWindowInsetsListener { v, insets ->
                val i = insets.getInsets(WindowInsets.Type.systemBars())
                v.setPadding(dp(22) + i.left, dp(30) + i.top, dp(22) + i.right, dp(22) + i.bottom)
                WindowInsets.CONSUMED
            }
        }
        setContentView(col)
    }

    private fun toggleSpeaker() {
        speaker = !speaker
        audio.isSpeakerphoneOn = speaker
        speakerBtn.text = if (speaker) "EARPIECE" else "SPEAKER"
    }

    private fun line(who: String, text: String) {
        if (text.isBlank()) return
        log.addView(text("${who.uppercase(Locale.US)}  $text", 15f, if (who == "Max") ink else amber, Typeface.DEFAULT).apply {
            setPadding(0, dp(6), 0, dp(6))
        })
        scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
    }

    private fun row() = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(10), 0, 0) }
    private fun weight() = LinearLayout.LayoutParams(0, dp(58), 1f).apply { marginStart = dp(4); marginEnd = dp(4) }
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun text(s: String, sp: Float, color: Int, tf: Typeface) = TextView(this).apply {
        text = s; setTextColor(color); setTextSize(TypedValue.COMPLEX_UNIT_SP, sp); typeface = tf
    }
    private fun button(label: String, color: Int, filled: Boolean, onClick: () -> Unit) = Button(this).apply {
        text = label
        typeface = condensed
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        setTextColor(if (filled) bg else color)
        stateListAnimator = null
        background = Cut(color, filled, dp(10).toFloat())
        gravity = Gravity.CENTER
        setOnClickListener { onClick() }
    }

    /** The HUD's chamfered shape: top-left and bottom-right corners cut. */
    private class Cut(private val color: Int, private val filled: Boolean, private val cut: Float) : Drawable() {
        private val p = Paint(Paint.ANTI_ALIAS_FLAG)
        override fun draw(c: Canvas) {
            val b = bounds
            val path = Path().apply {
                moveTo(b.left + cut, b.top.toFloat()); lineTo(b.right.toFloat(), b.top.toFloat())
                lineTo(b.right.toFloat(), b.bottom - cut); lineTo(b.right - cut, b.bottom.toFloat())
                lineTo(b.left.toFloat(), b.bottom.toFloat()); lineTo(b.left.toFloat(), b.top + cut); close()
            }
            p.color = color
            if (state.contains(android.R.attr.state_pressed)) { p.alpha = 120; p.style = Paint.Style.FILL; c.drawPath(path, p); return }
            if (filled) { p.style = Paint.Style.FILL; c.drawPath(path, p) }
            else { p.style = Paint.Style.FILL; p.alpha = 24; c.drawPath(path, p); p.alpha = 200; p.style = Paint.Style.STROKE; p.strokeWidth = 3f; c.drawPath(path, p) }
        }
        override fun isStateful() = true
        override fun onStateChange(s: IntArray): Boolean { invalidateSelf(); return true }
        override fun setAlpha(a: Int) {}
        override fun setColorFilter(f: ColorFilter?) {}
        @Deprecated("Drawable API") override fun getOpacity() = PixelFormat.TRANSLUCENT
    }

    @Deprecated("Back hangs up only through the button")
    @Suppress("DEPRECATION")
    override fun onBackPressed() { if (!answered) hangUp() }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        recognizer?.destroy()
        tts?.shutdown()
        if (answered) { audio.isSpeakerphoneOn = false; audio.mode = AudioManager.MODE_NORMAL }
        super.onDestroy()
    }
}
