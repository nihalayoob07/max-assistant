package app.max.assistant

import android.content.Context
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** The phone API on the home server (phone/phone-api.js). Blocking: call it off the main thread. */
object Api {
    private val urls = BuildConfig.MAX_URLS.split(',').map { it.trim().trimEnd('/') }.filter { it.isNotEmpty() }
    @Volatile private var good: String? = null

    /** Tries the last address that worked, then the rest (Tailscale away from home, the LAN, adb reverse). */
    fun call(ctx: Context, method: String, path: String, body: String? = null, readTimeoutMs: Int = 30_000): String {
        val sp = ctx.getSharedPreferences("max", Context.MODE_PRIVATE)
        val first = good ?: sp.getString("url", null)
        var last: Exception = IOException("no server address set")
        for (base in listOfNotNull(first) + urls.filter { it != first }) {
            val c = (URL(base + path).openConnection() as HttpURLConnection)
            try {
                c.requestMethod = method
                c.connectTimeout = 4_000
                c.readTimeout = readTimeoutMs
                c.setRequestProperty("Authorization", "Bearer ${BuildConfig.MAX_KEY}")
                if (body != null) { c.doOutput = true; c.setRequestProperty("Content-Type", "application/json") }
                try { c.connect() } catch (e: Exception) { last = e; continue }   // not reachable here: next address
                // Connected: from here a failure is final, so a slow decision is never sent twice.
                if (body != null) {
                    c.outputStream.use { it.write(body.toByteArray()) }
                }
                val code = c.responseCode
                val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
                if (good != base) { good = base; sp.edit().putString("url", base).apply() }
                if (code !in 200..299) throw ApiError(runCatching { JSONObject(text).getString("error") }.getOrDefault("server said $code"))
                return text
            } finally {
                c.disconnect()
            }
        }
        throw IOException("can't reach the home server (${last.message})")
    }

    class ApiError(msg: String) : IOException(msg)
}
