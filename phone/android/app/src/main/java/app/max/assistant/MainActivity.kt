package app.max.assistant

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.WindowInsets
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import java.io.ByteArrayInputStream
import java.io.IOException

/** The dashboard: the desktop app's UI in a WebView (assets/www), talking to the server through [Bridge]. */
class MainActivity : Activity() {

    companion object { const val HOST = "appassets.androidplatform.net" }

    lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val bg = Color.parseColor("#0A0A0A")
        web = WebView(this).apply {
            setBackgroundColor(bg)
            overScrollMode = WebView.OVER_SCROLL_NEVER
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.textZoom = 100
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            addJavascriptInterface(Bridge(this@MainActivity), "Android")
            webViewClient = AssetClient()
        }
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
            web.webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                    Log.d("MaxJS", "${m.messageLevel()} ${m.message()} @${m.sourceId()}:${m.lineNumber()}")
                    return true
                }
            }
        }
        val root = FrameLayout(this).apply { setBackgroundColor(bg); addView(web) }
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
            root.setOnApplyWindowInsetsListener { v, insets ->
                val i = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                v.setPadding(i.left, i.top, i.right, i.bottom)
                WindowInsets.CONSUMED
            }
        }
        setContentView(root)
        web.loadUrl("https://$HOST/index.html")
        CallService.channels(this)
        Push.register(this)
    }

    override fun onResume() {
        super.onResume()
        web.evaluateJavascript("window.maxNative && window.maxNative.onResume()", null)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        web.evaluateJavascript("window.maxNative && window.maxNative.onResume()", null)
    }

    fun js(code: String) = runOnUiThread { web.evaluateJavascript(code, null) }

    fun open(i: Intent) = runOnUiThread {
        runCatching { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.onFailure {
            runCatching { startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) }
        }
    }

    /** Serves assets/www over a fake https origin (same as Drill). */
    private inner class AssetClient : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val url = request.url
            if (url.host != HOST) return null
            val path = (url.path ?: "/").trimStart('/').ifEmpty { "index.html" }
            if (path.contains("..")) return notFound()
            return try {
                WebResourceResponse(mime(path), if (path.endsWith(".woff2")) null else "utf-8", assets.open("www/$path"))
            } catch (e: IOException) {
                notFound()
            }
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (request.url.host == HOST) return false
            runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
            return true
        }

        private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
        private fun mime(p: String) = when (p.substringAfterLast('.', "")) {
            "html" -> "text/html"
            "js" -> "text/javascript"
            "css" -> "text/css"
            "woff2" -> "font/woff2"
            "svg" -> "image/svg+xml"
            else -> "application/octet-stream"
        }
    }

    @Deprecated("Web history first")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }
}
