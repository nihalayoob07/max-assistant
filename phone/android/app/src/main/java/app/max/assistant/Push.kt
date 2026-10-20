package app.max.assistant

import android.content.Context
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject
import kotlin.concurrent.thread

/** FCM wakes the app with "Max is calling" and a call id, nothing else; what it is about comes from the server. */
class Push : FirebaseMessagingService() {
    override fun onMessageReceived(m: RemoteMessage) {
        val id = m.data["id"] ?: return
        if (m.data["type"] == "call" && CallService.ID.matches(id)) CallService.ring(this, id)
    }

    override fun onNewToken(token: String) { send(this, token) }

    companion object {
        /** False until google-services.json is in the build (your own Firebase project). */
        fun configured(ctx: Context) = runCatching { com.google.firebase.FirebaseApp.getInstance() }.isSuccess

        fun register(ctx: Context) {
            if (!configured(ctx)) return
            FirebaseMessaging.getInstance().token.addOnSuccessListener { send(ctx, it) }
        }

        private fun send(ctx: Context, token: String) = thread {
            runCatching { Api.call(ctx, "POST", "/token", JSONObject().put("token", token).toString()) }
                .onSuccess { ctx.getSharedPreferences("max", Context.MODE_PRIVATE).edit().putBoolean("registered", true).apply() }
        }
    }
}
