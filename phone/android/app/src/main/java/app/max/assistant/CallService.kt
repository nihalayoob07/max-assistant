package app.max.assistant

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator

/** "Max is calling": ringtone, vibration and the full-screen call screen over the lock screen (Drill's alarm pattern),
 *  then stays in the foreground for the length of the call. */
class CallService : Service() {

    companion object {
        const val CH_CALL = "max_call"
        const val CH_MISSED = "max_missed"
        private const val ID_CALL = 1
        private const val ID_MISSED = 2
        private const val RING_MS = 45_000L

        @Volatile var id: String? = null   // the call: L0002, E0003@2026-10-21, q:c..., brief:2026-10-21
        @Volatile var ringing = false

        fun ring(ctx: Context, id: String) {
            ctx.startForegroundService(Intent(ctx, CallService::class.java).setAction("ring").putExtra("id", id))
        }
        val ID = Regex("[A-Za-z0-9:@._-]{1,48}")

        /** What the ringing screen says before the details arrive (the push itself carries no details). */
        fun label(id: String) = when {
            id.startsWith("brief:") -> "Your morning brief"
            id.startsWith("q:") -> "A customer needs you"
            id.startsWith("E") -> "Meeting or reminder"
            else -> "$id needs your decision"
        }
        fun answer(ctx: Context) = ctx.startService(Intent(ctx, CallService::class.java).setAction("answer"))
        fun end(ctx: Context) = ctx.startService(Intent(ctx, CallService::class.java).setAction("end"))

        fun channels(ctx: Context) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CH_CALL, "Calls from Max", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Max rings you when a deal needs your decision. Keep this on."
                setSound(null, null)   // the service plays the ringtone itself
                enableVibration(false)
                setBypassDnd(true)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            })
            nm.createNotificationChannel(NotificationChannel(CH_MISSED, "Missed calls", NotificationManager.IMPORTANCE_HIGH))
        }
    }

    private val handler = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var wake: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            "ring" -> start(intent.getStringExtra("id") ?: return START_NOT_STICKY)
            "answer" -> { stopSound(); handler.removeCallbacks(missed); foreground("On a call with Max", "${id?.let { label(it) } ?: ""} · tap to return", false) }
            "end" -> stop()
            else -> if (!ringing && id == null) stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun start(call: String) {
        channels(this)
        if (id != null && !ringing) { foreground("On a call with Max", label(id!!), false); return }   // already on a call: don't ring over it
        id = call
        foreground("Max is calling", label(call), true)
        if (ringing) return
        ringing = true
        val pm = getSystemService(PowerManager::class.java)
        wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "max:call").apply { acquire(RING_MS + 60_000L) }
        if (!pm.isInteractive) runCatching {
            @Suppress("DEPRECATION")
            pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE, "max:screen")
                .acquire(10_000L)
        }
        runCatching {
            val uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_RINGTONE)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            player = MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                setDataSource(this@CallService, uri)
                isLooping = true
                prepare()
                start()
            }
        }
        getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 1000, 1000), 0))
        handler.postDelayed(missed, RING_MS)
        // With the screen already on, a full-screen intent only shows a heads-up: open the call screen directly too.
        runCatching { startActivity(callIntent(false)) }
    }

    private fun callIntent(answer: Boolean) = Intent(this, CallActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)
        .putExtra("answer", answer)

    private fun foreground(title: String, text: String, incoming: Boolean) {
        val pi = { answer: Boolean, rc: Int -> PendingIntent.getActivity(this, rc, callIntent(answer), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
        val b = Notification.Builder(this, CH_CALL)
            .setSmallIcon(R.drawable.ic_stat)
            .setColor(0xFF38DBE6.toInt())
            .setContentTitle(title)
            .setContentText(text)
            .setCategory(Notification.CATEGORY_CALL)
            .setContentIntent(pi(false, 1))
            .setOngoing(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
        if (incoming) {
            b.setFullScreenIntent(pi(false, 1), true)
            b.addAction(Notification.Action.Builder(null, "Decline",
                PendingIntent.getService(this, 3, Intent(this, CallService::class.java).setAction("end"), PendingIntent.FLAG_IMMUTABLE)).build())
            b.addAction(Notification.Action.Builder(null, "Answer", pi(true, 2)).build())
        }
        val n = b.build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID_CALL, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
        else startForeground(ID_CALL, n)
    }

    /** Nobody answered: leave a missed call. Telegram already has the same alert. */
    private val missed = Runnable {
        val what = id?.let { label(it) } ?: ""
        val open = PendingIntent.getActivity(this, 4, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE)
        getSystemService(NotificationManager::class.java).notify(ID_MISSED, Notification.Builder(this, CH_MISSED)
            .setSmallIcon(R.drawable.ic_stat).setColor(0xFFFF8A1E.toInt())
            .setContentTitle("Missed call from Max").setContentText("$what (see the app or Telegram)")
            .setContentIntent(open).setAutoCancel(true).build())
        stop()
    }

    private fun stopSound() {
        ringing = false
        runCatching { player?.stop() }
        player?.release()
        player = null
        getSystemService(Vibrator::class.java)?.cancel()
        runCatching { if (wake?.isHeld == true) wake?.release() }
        wake = null
    }

    private fun stop() {
        handler.removeCallbacksAndMessages(null)
        stopSound()
        id = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        stopSound()
        id = null
        super.onDestroy()
    }
}
