package app.max.assistant

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.animation.Animator
import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Base64
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.transition.AutoTransition
import android.transition.TransitionManager
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.animation.DecelerateInterpolator
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.Chronometer
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale
import kotlin.concurrent.thread

/** The call: rings, then Max reads out the deal (TextToSpeech), listens (SpeechRecognizer), repeats back what it
 *  understood, and only acts on a "yes". The buttons do the same without talking. */
class CallActivity : Activity() {

    // The dashboard's palette (jet black, cerulean, rose), with a phone's own green Answer and red Decline / Hang up.
    private val bg = Color.parseColor("#0A0A0A")
    private val blue = Color.parseColor("#4FB8E0")
    private val rose = Color.parseColor("#FF2D95")
    private val grey = Color.parseColor("#2A2C30")
    private val chip = Color.parseColor("#26262E")   // quiet round buttons
    private val card = Color.parseColor("#16161C")   // preview lines and Max's bubbles
    private val green = Color.parseColor("#30A46C")  // answer
    private val red = Color.parseColor("#E5484D")    // decline, hang up
    private val pink = Color.parseColor("#FF8CC4")
    private val light = Typeface.create("sans-serif-light", Typeface.NORMAL)
    private val ink = Color.parseColor("#EDEDEE")
    private val muted = Color.parseColor("#8B9098")
    private val condensed = Typeface.create("sans-serif-condensed", Typeface.BOLD)
    private val mono = Typeface.MONOSPACE

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var status: TextView
    private lateinit var title: TextView
    private lateinit var log: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var ringRow: LinearLayout
    private lateinit var dealRow: LinearLayout
    private lateinit var callRow: LinearLayout

    private var id = ""
    private var deal: JSONObject? = null   // what this call is about (server: GET /call)
    private val talking get() = id.startsWith("brief:") || id.startsWith("E") || id.startsWith("me:") || id.startsWith("won:")   // after Max speaks, a conversation with Max
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var ttsInit = false        // the engine answered (ready or not)
    private var recognizer: SpeechRecognizer? = null
    private var offline = true          // prefer the offline English pack; dropped if this phone doesn't have it
    private var answered = false
    private var busy = false            // a decision is being written: no more listening
    private var pending: JSONObject? = null   // a decision Max read back, waiting for "yes"
    private var misses = 0
    private var speaker = true   // Max plays on the loudspeaker as media (full quality); the button switches to the earpiece
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
            .onFailure { e -> runOnUiThread { status.text = "Can't reach the server"; line("Max", "I can't get this call's details (${e.message}). It's on Telegram too.") } }
    }
    private var ttsStarted = false

    private fun answer() {
        answered = true
        CallService.answer(this)
        toCall()
        status.text = "Connecting…"
        route()
        tts = TextToSpeech(this) { ok ->
            ttsReady = ok == TextToSpeech.SUCCESS
            ttsInit = true
            tts?.let { pickVoice(it) }
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

    private var player: MediaPlayer? = null
    private var said = 0   // bumped by every line and by stopVoice(): a late ElevenLabs reply for an old line is dropped

    /** Max's voice: ElevenLabs, made by the server (POST /tts, so the key never sits on the phone), else the phone's
     *  own TextToSpeech when the server can't (no key, offline, out of credits). */
    private fun say(text: String, then: (() -> Unit)? = null) {
        line("Max", text)
        status.text = "Max is speaking"
        route()
        // The screen shows the text as written; the voice uses the server's pronunciation hints (SAY_NAME).
        var spoken = text
        deal?.optJSONObject("pronounce")?.let { p -> p.keys().forEach { k -> spoken = spoken.replace(Regex("\\b${Regex.escape(k)}\\b"), p.getString(k)) } }
        val n = ++said
        thread {
            val mp3 = runCatching { Base64.decode(JSONObject(Api.call(this, "POST", "/tts", JSONObject().put("text", spoken).toString(), 25_000)).getString("audio"), Base64.DEFAULT) }
                .onFailure { Log.w("MaxCall", "ElevenLabs voice: ${it.message}") }.getOrNull()
            runOnUiThread {
                if (n != said || isFinishing) return@runOnUiThread
                if (mp3 == null || !play(mp3, then)) speakLocal(spoken.replace("₹", "rupees "), then)
            }
        }
    }

    private fun play(mp3: ByteArray, then: (() -> Unit)?) = runCatching {
        val f = File(cacheDir, "say.mp3").apply { writeBytes(mp3) }
        player?.release()
        player = MediaPlayer().apply {
            setAudioAttributes(voiceAttrs())
            setDataSource(f.path)
            setOnCompletionListener { then?.invoke() }
            prepare()
            start()
        }
    }.onFailure { Log.w("MaxCall", "playing the voice: ${it.message}") }.isSuccess

    /** Loudspeaker: Max plays as media, at full quality. Earpiece: as call audio, held to the ear like a phone call; the
     *  call path's processing (narrow band, compression, noise suppression) dulls the voice, so it isn't the default. */
    private fun route() {
        audio.mode = if (speaker) AudioManager.MODE_NORMAL else AudioManager.MODE_IN_COMMUNICATION
        audio.isSpeakerphoneOn = false
        tts?.setAudioAttributes(voiceAttrs())
    }
    private fun voiceAttrs() = AudioAttributes.Builder()
        .setUsage(if (speaker) AudioAttributes.USAGE_MEDIA else AudioAttributes.USAGE_VOICE_COMMUNICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()

    private fun stopVoice() { said++; tts?.stop(); player?.release(); player = null }

    private fun speakLocal(spoken: String, then: (() -> Unit)?) {
        val t = tts
        if (t == null || !ttsReady) { handler.postDelayed({ then?.invoke() }, 1500); return }
        val id = System.nanoTime().toString()
        t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(u: String?) {}
            override fun onDone(u: String?) { if (u == id) runOnUiThread { then?.invoke() } }
            @Deprecated("old API") override fun onError(u: String?) { if (u == id) runOnUiThread { then?.invoke() } }
        })
        t.speak(spoken, TextToSpeech.QUEUE_FLUSH, null, id)
    }

    private fun listen() {
        if (busy || isFinishing) return
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED || !SpeechRecognizer.isRecognitionAvailable(this)) {
            status.text = "Use the buttons"
            return
        }
        status.text = if (pending != null) "Say yes or no" else "Listening…"
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
                override fun onBeginningOfSpeech() { status.text = "Hearing you…" }
                override fun onRmsChanged(v: Float) {}
                override fun onBufferReceived(b: ByteArray?) {}
                override fun onEndOfSpeech() { status.text = "Thinking…" }
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
        if (stage == CHATTING) {   // no reply to the small talk yet: listen once more, then move on
            if (++chatMisses < 2) { listen(); return }
            if (answerReady != null) { deliver("Anyway, here's what I've got."); return }
            stage = ACKING
            say("No worries.") { afterLine(turn) }; return
        }
        if (talking && misses >= 1) { say("Okay, talk later. Bye.") { hangUp() }; return }
        if (++misses > 2) { status.text = "Tap Talk, or use the buttons"; return }
        say(if (talking) "Anything else? Just say it, or say bye." else "Sorry, I didn't hear you.") { listen() }
    }

    private val yes = Regex("\\b(yes|yeah|yep|yup|right|correct|confirm|do it|go ahead|sure|ok|okay|haan)\\b", RegexOption.IGNORE_CASE)
    private val no = Regex("\\b(no|nope|nah|wait|cancel|wrong|don't|stop)\\b", RegexOption.IGNORE_CASE)

    private fun heard(text: String) {
        misses = 0
        line("You", text)
        if (stage == CHATTING) { chatBack(text); return }   // their reply to the small talk while main Max works
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
        status.text = "Thinking…"
        // Small talk and common questions come back at once. For a slower answer from main Max, Max holds the call like
        // a person would: a line that shows it understood (written by the fast model, /call/ack), then small talk that
        // it listens to and reacts to, and the answer once it's in and the owner has finished speaking.
        val t = ++turn
        stage = WAITING
        answerReady = null
        chatted = false
        var ackLine: String? = null
        thread {
            ackLine = runCatching { JSONObject(Api.call(this, "POST", "/call/ack", JSONObject().put("text", text).toString(), 3_000)).optString("ack") }
                .getOrNull()?.takeIf { it.isNotBlank() }
        }
        holdOn = Runnable {
            if (t != turn || answerReady != null) return@Runnable
            stage = ACKING
            say(ackLine ?: fallbackAck(text)) { afterLine(t) }
        }
        handler.postDelayed(holdOn, 1_500)
        thread {
            val r = runCatching { JSONObject(Api.call(this, "POST", "/call/answer", JSONObject().put("id", id).put("text", text).toString(), 240_000)) }
            runOnUiThread {
                if (t != turn) return@runOnUiThread   // dropped ("never mind") or replaced by a newer question
                handler.removeCallbacks(holdOn)
                handler.removeCallbacks(askSmall)
                answerReady = r
                // Waiting or in a pause: answer now. Mid-line: after it (afterLine). After a question: after their reply.
                if (stage == WAITING || stage == PAUSE) deliver(if (chatted) "Okay, here's what I've got." else "")
            }
        }
    }

    // ---------- holding the call while main Max works ----------
    // One line at a time, like a person: an acknowledgement, a pause, then (if the answer still isn't in) one small-talk
    // question; Max always waits for the reply, reacts, then either answers or pauses again.
    private val WAITING = 0; private val ACKING = 1; private val PAUSE = 2; private val CHATTING = 3
    private var stage = WAITING
    private var turn = 0                                 // bumped by each question; an answer for an old one is dropped
    private var answerReady: Result<JSONObject>? = null  // the answer, once it's in
    private var chatted = false                          // there was small talk this turn, so the answer gets a bridge
    private var chatMisses = 0
    private val askedSmall = mutableListOf<String>()     // small-talk questions already asked on this call
    private var lastSmall = ""                           // the one just asked, so the reaction fits it
    private val smallTalk = mutableListOf<JSONObject>()  // this small-talk thread, for the fast model's next line
    private var holdOn = Runnable {}
    private var askSmall = Runnable {}

    /** A hold line (acknowledgement or reaction) finished: answer if it's in, else pause, then ask something small. */
    private fun afterLine(t: Int) {
        if (t != turn) return
        if (answerReady != null) { deliver(if (chatted) "Anyway, here's what I've got." else ""); return }
        stage = PAUSE
        askSmall = Runnable {
            if (t != turn || answerReady != null || stage != PAUSE) return@Runnable
            val q = smallQuestion() ?: return@Runnable   // out of questions: just wait quietly for the answer
            stage = CHATTING
            chatted = true
            chatMisses = 0
            val opener = "${listOf("By the way,", "Also,", "Just wondering,", "Oh, by the way,").random()} ${q.replaceFirstChar { it.lowercase() }}"
            smallTalk.clear()
            smallTalk += JSONObject().put("role", "assistant").put("content", opener)
            say(opener) { listen() }
        }
        handler.postDelayed(askSmall, 2_500)
    }

    /** The answer, led by a short bridge from the small talk ("Nice, glad to hear it. Anyway, here's what I've got."). */
    private fun deliver(lead: String) {
        val r = answerReady ?: return
        answerReady = null
        stage = WAITING
        r.onSuccess { j ->
            pending = j.optJSONObject("decision")
            say(listOf(lead, j.optString("say")).filter { it.isNotBlank() }.joinToString(" ")) { listen() }
        }.onFailure { e -> say("$lead I couldn't reach the server: ${e.message}".trim()) { listen() } }
    }

    /** What the owner said during the small talk: react like a person, then either give the answer or chat a bit more. */
    private fun chatBack(said: String) {
        val t = " ${said.lowercase(Locale.US)} "
        fun has(vararg w: String) = w.any { t.contains(" $it") }
        if (has("never mind", "nevermind", "cancel", "forget it", "forget that", "drop it")) {
            turn++; stage = WAITING; answerReady = null
            say("Okay, dropping that. Anything else?") { listen() }; return
        }
        if (has("bye", "that's all", "gotta go", "got to go")) { say("Okay. Bye.") { hangUp() }; return }
        val bad = has("bad", "tired", "rough", "stress", "hectic", "long day", "not great", "not good", "meh", "sick", "exhausted", "sleepy",
            "terrible", "awful", "not really", "barely")
        val good = !bad && has("good", "great", "nice", "fine", "awesome", "amazing", "chill", "relaxed", "productive", "well", "yes", "yeah",
            "yep", "done", "had", "sure", "busy", "fun", "excited")
        val no = !bad && !good && has("no", "not yet", "nope", "nah", "haven't", "nothing")
        // A reaction to what was asked, so it sounds like listening, not a canned line.
        val (yes, nope, meh) = when (lastSmall) {
            "Had breakfast yet?", "Had lunch yet?", "Had dinner yet?" -> Triple("Good, can't run on empty.", "Don't skip it, alright?", "Fair enough.")
            "How did you sleep?" -> Triple("Nice, a good night's sleep makes everything easier.", "Ah, rough night. Go easy today.", "Got it.")
            "Busy at the shop today?" -> Triple("Busy is good for business.", "A quiet one, then. Not bad either.", "Makes sense.")
            "Got anything fun planned for the weekend?" -> Triple("Nice, sounds fun.", "A lazy weekend sounds good too.", "Ha, fair enough.")
            "Getting any rest today?" -> Triple("Good, you need it.", "Try to grab a break if you can.", "Fair.")
            "Any good news today?" -> Triple("Love that.", "It'll come.", "Ha, fair enough.")
            else -> Triple("Nice, glad to hear it.", "Ah, okay.", "Ha, fair enough.")
        }
        val reaction = when { bad -> listOf("Oof, sounds like a long one.", "Sorry to hear that.", "Ah, hang in there.").random(); good -> yes; no -> nope; else -> meh }
        // The rest of the chat comes from the fast model (/call/chat): a reaction and a follow-up on the same topic,
        // or, once the answer is in, just a reaction. The lines above are the fallback if it's slow or fails.
        smallTalk += JSONObject().put("role", "user").put("content", said)
        val t0 = turn
        stage = ACKING   // thinking of a reply; nothing listens until Max has said it
        thread {
            val ready = answerReady != null
            val line = runCatching {
                JSONObject(Api.call(this, "POST", "/call/chat", JSONObject().put("history", JSONArray(smallTalk)).put("ready", ready).toString(), 4_000))
                    .optString("line")
            }.getOrNull()?.takeIf { it.isNotBlank() }
            runOnUiThread {
                if (t0 != turn) return@runOnUiThread
                if (answerReady != null) {   // the answer's in: a reaction (no question), then the answer
                    deliver("${if (ready && line != null) line else reaction} Anyway, here's what I've got."); return@runOnUiThread
                }
                if (line == null) { say(reaction) { afterLine(turn) }; return@runOnUiThread }
                smallTalk += JSONObject().put("role", "assistant").put("content", line)
                stage = CHATTING
                chatMisses = 0
                say(line) { listen() }
            }
        }
    }

    /** Small talk that suits the time of day, never the same question twice on a call. */
    private fun smallQuestion(): String? {
        val h = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
        val day = when { h < 12 -> "How did you sleep?"; h < 17 -> "How's the day going so far?"; else -> "How was your day?" }
        val meal = when (h) { in 5..10 -> "Had breakfast yet?"; in 11..15 -> "Had lunch yet?"; in 18..22 -> "Had dinner yet?"; else -> null }
        val rest = listOf("Busy at the shop today?", "Got anything fun planned for the weekend?", "Getting any rest today?",
            "What have you been up to?", "Any good news today?").shuffled()
        val q = (listOfNotNull(day, meal) + rest).firstOrNull { it !in askedSmall } ?: return null
        askedSmall += q
        lastSmall = q
        return q
    }

    /** If the fast model's line is slow or missing: a plain one that fits the kind of request. */
    private fun fallbackAck(said: String): String {
        val t = said.lowercase(Locale.US)
        fun has(vararg w: String) = w.any { t.contains(it) }
        return when {
            has("calendar", "schedule", "meeting", "appointment") -> "Let me look at your calendar."
            has("lead", "deal", "client", "customer", "order", "quote", "invoice", "payment") -> "Let me check on that."
            has("open ", "play ", "youtube", "laptop", "volume") -> "On it."
            has("remind", "remember", "note that", "add ") -> "Sure, noting that down."
            else -> "Okay, give me a second on that."
        }
    }

    /** The confirmed decision goes to the same owner path as the desktop card and Telegram's buttons. */
    private fun decide(d: JSONObject) {
        busy = true
        recognizer?.cancel()
        dealRow.visibility = View.GONE
        say("On it, this takes a few seconds.")
        status.text = "Working on it…"
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
    // Ringing: Max's avatar with pulsing rings, who's calling and why, then a few lines on what the call is about
    // (the server's "points"), with Decline / Chat / Answer. Answering slides the avatar into a header with the
    // timer, and the conversation appears as chat bubbles above Speaker / Talk / Hang up.
    private lateinit var root: LinearLayout
    private lateinit var header: LinearLayout
    private lateinit var avatar: FrameLayout
    private lateinit var initial: TextView
    private lateinit var who: LinearLayout
    private lateinit var name: TextView
    private lateinit var points: LinearLayout
    private lateinit var topSpace: View
    private val ringViews = mutableListOf<View>()
    private val anims = mutableListOf<Animator>()

    /** The call's title, details, preview lines and answer buttons all come from the server (phone-api.js callInfo). */
    private fun showCall(d: JSONObject) {
        title.text = listOf(d.optString("title"), d.optString("sub")).filter { it.isNotBlank() }.joinToString("\n")
        points.removeAllViews()
        val p = d.optJSONArray("points") ?: JSONArray()
        for (i in 0 until minOf(p.length(), 3)) {
            val (icon, s) = p.getJSONArray(i).let { it.optString(0) to it.optString(1) }
            if (s.isBlank()) continue
            val c = pointCard(icon, s)
            points.addView(c, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
            rise(c, 150L + 150L * i)
        }
        dealRow.removeAllViews()
        val buttons = d.optJSONArray("buttons") ?: return
        for (i in 0 until buttons.length()) {
            val b = buttons.getJSONObject(i)
            val (color, filled) = when (b.optString("style")) { "primary" -> rose to true; "danger" -> muted to false; else -> blue to false }
            dealRow.addView(button(b.optString("label"), color, filled) { decide(b.getJSONObject("decision")) }, weight())
        }
    }

    private fun build() {
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; clipChildren = false }
        header = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; clipChildren = false }
        avatar = FrameLayout(this).apply { clipChildren = false }
        repeat(2) { i ->
            val ring = View(this).apply { background = oval(Color.TRANSPARENT, blue); alpha = 0f }
            avatar.addView(ring, FrameLayout.LayoutParams(-1, -1))
            ringViews += ring
            pulse(ring, i * 1200L)
        }
        initial = text("M", 44f, Color.parseColor("#8FD6F2"), light).apply { gravity = Gravity.CENTER; background = oval(Color.parseColor("#0F2530"), null) }
        avatar.addView(initial, FrameLayout.LayoutParams(-1, -1))
        header.addView(avatar, LinearLayout.LayoutParams(dp(104), dp(104)))
        who = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL }
        name = text("Max", 34f, ink, light).apply { gravity = Gravity.CENTER }
        who.addView(name)
        title = text(CallService.label(id), 14f, muted, Typeface.DEFAULT).apply { gravity = Gravity.CENTER; setPadding(0, dp(6), 0, 0); setLineSpacing(0f, 1.15f) }
        who.addView(title)
        timer = Chronometer(this).apply { setTextColor(blue); typeface = mono; setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f); visibility = View.GONE; setPadding(0, dp(2), 0, 0) }
        who.addView(timer)
        status = text(if (id.startsWith("me:")) "Calling…" else "Incoming call", 13f, blue, Typeface.DEFAULT).apply { gravity = Gravity.CENTER; setPadding(0, dp(6), 0, 0) }
        who.addView(status)
        header.addView(who, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(24) })
        topSpace = View(this)   // while ringing, the caller sits a third of the way down, not crammed at the top
        root.addView(topSpace, LinearLayout.LayoutParams(-1, 0, 0.5f))
        root.addView(header, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(16) })
        rise(header, 0)

        points = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(points, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(22) })
        log = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        scroll = ScrollView(this).apply { addView(log); isFillViewport = true; isVerticalScrollBarEnabled = false }
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f).apply { topMargin = dp(12) })

        dealRow = row().apply { visibility = View.GONE }
        root.addView(dealRow)
        callRow = roundRow().apply { visibility = View.GONE }
        val (speakerKey, speakerText) = roundButton(R.drawable.ic_volume, "Earpiece", chip, 60) { toggleSpeaker() }
        speakerLabel = speakerText
        callRow.addView(speakerKey)
        callRow.addView(roundButton(R.drawable.ic_mic, "Talk", chip, 60) { misses = 0; if (!busy) { stopVoice(); pending = null; listen() } }.first)
        callRow.addView(roundButton(R.drawable.ic_call_end, "Hang up", red, 60) { hangUp() }.first)
        root.addView(callRow)
        ringRow = roundRow()
        ringRow.addView(roundButton(R.drawable.ic_call_end, "Decline", red, 66) { hangUp() }.first)
        ringRow.addView(roundButton(R.drawable.ic_chat, "Chat", chip, 54) { openChat() }.first)
        val (answerKey) = roundButton(R.drawable.ic_call, "Answer", green, 66) { answer() }
        ringRow.addView(answerKey)
        breathe(answerKey.getChildAt(0))
        root.addView(ringRow)

        root.setBackgroundColor(bg)
        window.statusBarColor = bg
        window.navigationBarColor = bg
        val pad = { l: Int, t: Int, r: Int, b: Int -> root.setPadding(dp(22) + l, dp(16) + t, dp(22) + r, dp(28) + b) }
        pad(0, 0, 0, 0)
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
            root.setOnApplyWindowInsetsListener { _, insets ->
                val i = insets.getInsets(WindowInsets.Type.systemBars())
                pad(i.left, i.top, i.right, i.bottom)
                WindowInsets.CONSUMED
            }
        }
        setContentView(root)
    }

    /** Answered: the rings stop, the avatar slides up into a header with the timer, and the call buttons swap in. */
    private fun toCall() {
        TransitionManager.beginDelayedTransition(root, AutoTransition().setDuration(350))
        anims.forEach { it.cancel() }
        ringViews.forEach { it.visibility = View.GONE }
        header.orientation = LinearLayout.HORIZONTAL
        header.gravity = Gravity.CENTER_VERTICAL
        (header.layoutParams as LinearLayout.LayoutParams).topMargin = dp(8)
        avatar.layoutParams = LinearLayout.LayoutParams(dp(52), dp(52))
        initial.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
        who.gravity = Gravity.START
        who.layoutParams = LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = dp(14) }
        name.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
        listOf(name, title, status).forEach { it.gravity = Gravity.START }
        topSpace.visibility = View.GONE
        title.maxLines = 1
        points.visibility = View.GONE
        ringRow.visibility = View.GONE
        callRow.visibility = View.VISIBLE
        startTimer()
    }

    /** "Chat": stop ringing and open the app's chat with Max instead. */
    private fun openChat() {
        startActivity(Intent(this, MainActivity::class.java).putExtra("chat", true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        hangUp()
    }

    private lateinit var timer: Chronometer
    private lateinit var speakerLabel: TextView
    /** The call timer, like a phone's, from the moment the call is answered. */
    private fun startTimer() {
        timer.base = SystemClock.elapsedRealtime()
        timer.visibility = View.VISIBLE
        timer.start()
    }

    /** A round call button with its label underneath, as on a phone's dialer. */
    private fun roundButton(icon: Int, label: String, fill: Int, size: Int, onClick: () -> Unit): Pair<LinearLayout, TextView> {
        val key = ImageButton(this).apply {
            setImageResource(icon)
            setColorFilter(Color.WHITE)
            scaleType = ImageView.ScaleType.FIT_CENTER
            val p = dp(size) * 27 / 100
            setPadding(p, p, p, p)
            background = StateListDrawable().apply {
                addState(intArrayOf(android.R.attr.state_pressed), oval(fill, null).apply { alpha = 150 })
                addState(intArrayOf(), oval(fill, null))
            }
            contentDescription = label
            setOnClickListener { onClick() }
        }
        val name = text(label, 12f, muted, Typeface.DEFAULT).apply { gravity = Gravity.CENTER; setPadding(0, dp(8), 0, 0) }
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL or Gravity.BOTTOM
            addView(key, LinearLayout.LayoutParams(dp(size), dp(size)))
            addView(name)
        }
        box.layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        return box to name
    }
    private fun roundRow() = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.BOTTOM; setPadding(0, dp(18), 0, 0) }

    /** One line on what the call is about, on the ringing screen. */
    private fun pointCard(icon: String, s: String) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(14), dp(12), dp(14), dp(12))
        background = GradientDrawable().apply { setColor(card); cornerRadius = dp(14).toFloat() }
        val res = when (icon) { "money" -> R.drawable.ic_money; "calendar" -> R.drawable.ic_calendar; "print" -> R.drawable.ic_print
            "chat" -> R.drawable.ic_chat; "person" -> R.drawable.ic_person; else -> R.drawable.ic_task }
        addView(ImageView(this@CallActivity).apply { setImageResource(res); setColorFilter(pink) }, LinearLayout.LayoutParams(dp(20), dp(20)))
        addView(text(s, 14f, ink, Typeface.DEFAULT).apply { maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END },
            LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = dp(12) })
    }

    // ---------- motion ----------
    private fun pulse(v: View, delay: Long) {
        anims += AnimatorSet().apply {
            playTogether(listOf(View.SCALE_X to 1.9f, View.SCALE_Y to 1.9f, View.ALPHA to 0f).map { (prop, to) ->
                ObjectAnimator.ofFloat(v, prop, if (prop == View.ALPHA) 0.5f else 1f, to).apply { repeatCount = ValueAnimator.INFINITE } })
            duration = 2400
            startDelay = delay
            interpolator = DecelerateInterpolator()
            start()
        }
    }
    private fun breathe(v: View) {
        anims += AnimatorSet().apply {
            playTogether(listOf(View.SCALE_X, View.SCALE_Y).map { prop ->
                ObjectAnimator.ofFloat(v, prop, 1f, 1.07f).apply { repeatCount = ValueAnimator.INFINITE; repeatMode = ValueAnimator.REVERSE } })
            duration = 800
            interpolator = AccelerateDecelerateInterpolator()
            start()
        }
    }
    private fun rise(v: View, delay: Long) {
        v.alpha = 0f
        v.translationY = dp(14).toFloat()
        v.animate().alpha(1f).translationY(0f).setStartDelay(delay).setDuration(450).setInterpolator(DecelerateInterpolator()).start()
    }

    private fun toggleSpeaker() {
        speaker = !speaker
        route()
        speakerLabel.text = if (speaker) "Earpiece" else "Speaker"
    }

    /** The conversation as chat bubbles: Max on the left, you on the right, misses as a quiet note. */
    private fun line(who: String, text: String) {
        if (text.isBlank()) return
        val me = who == "You"
        val note = who == "·"
        val v = if (note) text(text, 12f, muted, Typeface.DEFAULT)
        else text(text, 15f, if (me) Color.parseColor("#FFD0E6") else ink, Typeface.DEFAULT).apply {
            setPadding(dp(12), dp(9), dp(12), dp(9))
            setLineSpacing(0f, 1.15f)
            val r = dp(14).toFloat(); val s = dp(4).toFloat()
            background = GradientDrawable().apply {
                setColor(if (me) Color.parseColor("#2A1020") else card)
                cornerRadii = if (me) floatArrayOf(r, r, r, r, s, s, r, r) else floatArrayOf(r, r, r, r, r, r, s, s)
            }
        }
        log.addView(v, LinearLayout.LayoutParams(-2, -2).apply {
            gravity = when { note -> Gravity.CENTER_HORIZONTAL; me -> Gravity.END; else -> Gravity.START }
            topMargin = dp(8)
            if (me) marginStart = dp(48) else if (!note) marginEnd = dp(48)
        })
        v.alpha = 0f
        v.translationY = dp(8).toFloat()
        v.animate().alpha(1f).translationY(0f).setDuration(250).start()
        scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
    }

    private fun oval(fill: Int, stroke: Int?) = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(fill)
        if (stroke != null) setStroke(dp(2), stroke)
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
        isAllCaps = false
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
        setTextColor(if (!filled) color else if (color == grey) ink else bg)
        stateListAnimator = null
        background = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_pressed), pill(color, true).apply { alpha = 140 })
            addState(intArrayOf(), pill(color, filled))
        }
        gravity = Gravity.CENTER
        setOnClickListener { onClick() }
    }

    private fun pill(color: Int, filled: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(16).toFloat()
        if (filled) setColor(color)
        else { setColor(Color.argb(30, Color.red(color), Color.green(color), Color.blue(color))); setStroke(dp(1), color) }
    }

    @Deprecated("Back hangs up only through the button")
    @Suppress("DEPRECATION")
    override fun onBackPressed() { if (!answered) hangUp() }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        recognizer?.destroy()
        tts?.shutdown()
        player?.release()
        if (answered) { audio.isSpeakerphoneOn = false; audio.mode = AudioManager.MODE_NORMAL }
        super.onDestroy()
    }
}
