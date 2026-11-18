package com.snowpdf.app

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.OpenableColumns
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.animation.LinearInterpolator
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import androidx.activity.enableEdgeToEdge
import androidx.core.content.IntentCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File

/** Path separator stripped from received file names, as a code point to avoid escaping pitfalls. */
private val BACKSLASH: Char = 92.toChar()

/** The loading screen goes away by itself after this long, whatever the page is doing. */
private const val LOADING_LIMIT_MS = 10000L

class MainActivity : TauriActivity() {
  private val handler = Handler(Looper.getMainLooper())
  private var webView: WebView? = null
  /** The loading screen while it is up, and what moves on it. */
  private var loading: View? = null
  private val loadingMotion = ArrayList<ValueAnimator>()
  private var loadingSince = 0L

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    // Before the webview starts, so the files exist when the JS side asks for them.
    if (savedInstanceState == null) {
      cleanOldIncoming()
      handleIncoming(intent)
    }
    super.onCreate(savedInstanceState)

    val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    val content = findViewById<View>(android.R.id.content)
    content.setBackgroundColor(if (night) Color.parseColor("#171717") else Color.parseColor("#ffffff"))
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
      )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      // The loading screen lies over the whole window: the same room for the bars, so its logo
      // sits where the page's own loading screen will show it.
      loading?.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
    showLoading(night)
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    controller.isAppearanceLightStatusBars = !night
    controller.isAppearanceLightNavigationBars = !night
  }

  /**
   * Android scales every font in the WebView by the system font size (text zoom). That also
   * enlarges pdf.js's invisible text layer, which then no longer lines up with the page: text
   * selection lands beside or below the finger. Keep the WebView at 100 % and hand the scale to
   * the page instead (user agent token, read by index.html), which applies it to the app's own UI.
   */
  override fun onWebViewCreate(webView: WebView) {
    val percent = Math.round(resources.configuration.fontScale * 100f)
    webView.settings.textZoom = 100
    webView.settings.userAgentString = webView.settings.userAgentString + " SnowPDFTextZoom/" + percent
    this.webView = webView
    watchPage()
  }

  /**
   * The WebView takes a second or two to start, and until its page draws the window is blank.
   * This covers that time with the same picture the page shows next while its own code loads
   * (the loading screen of index.html: the asterisk of the logo turning, a bar running under
   * it), so both read as one screen.
   */
  private fun showLoading(night: Boolean) {
    val density = resources.displayMetrics.density
    val px = { dp: Float -> Math.round(dp * density) }
    val logoWidth = px(88f)
    val logoHeight = px(88f)

    val flake = ImageView(this).apply {
      setImageResource(R.drawable.splash_flake)
      pivotX = logoWidth / 2f
      pivotY = logoHeight / 2f
    }
    val logo = FrameLayout(this).apply {
      addView(flake, FrameLayout.LayoutParams(logoWidth, logoHeight))
    }

    val rounded = { color: Int -> GradientDrawable().apply { cornerRadius = 2f * density; setColor(color) } }
    val runnerWidth = px(132f * 0.4f)
    val runner = View(this).apply { background = rounded(Color.parseColor("#ff4f1f")) }
    val bar = FrameLayout(this).apply {
      background = rounded(Color.parseColor("#2eff4f1f"))
      clipToOutline = true
      addView(runner, FrameLayout.LayoutParams(runnerWidth, px(4f)))
    }

    val column = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      addView(logo, LinearLayout.LayoutParams(logoWidth, logoHeight))
      addView(bar, LinearLayout.LayoutParams(px(132f), px(4f)).apply { topMargin = px(28f) })
    }
    // Behind the bars, the colour the app puts there; in between, the page's.
    val page = FrameLayout(this).apply {
      setBackgroundColor(Color.parseColor(if (night) "#0e0e0e" else "#f4f4f2"))
      addView(column, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
    }
    val screen = FrameLayout(this).apply {
      setBackgroundColor(Color.parseColor(if (night) "#171717" else "#ffffff"))
      // Taps don't reach a page that is not there yet.
      isClickable = true
      addView(page, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }
    // On the window itself: the WebView replaces everything in the content view when it arrives.
    (window.decorView as ViewGroup).addView(screen, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

    val forever = { animator: ObjectAnimator, millis: Long, mode: Int ->
      animator.duration = millis
      animator.repeatCount = ValueAnimator.INFINITE
      animator.repeatMode = mode
      animator.start()
      loadingMotion.add(animator)
    }
    forever(ObjectAnimator.ofFloat(flake, View.ROTATION, 0f, 360f).apply { interpolator = LinearInterpolator() }, 6000L, ValueAnimator.RESTART)
    forever(ObjectAnimator.ofFloat(logo, View.TRANSLATION_Y, 0f, -8f * density).apply { interpolator = AccelerateDecelerateInterpolator() }, 1200L, ValueAnimator.REVERSE)
    forever(
      ObjectAnimator.ofFloat(runner, View.TRANSLATION_X, -1.1f * runnerWidth, 2.6f * runnerWidth).apply { interpolator = AccelerateDecelerateInterpolator() },
      1200L,
      ValueAnimator.RESTART,
    )

    loading = screen
    loadingSince = SystemClock.uptimeMillis()
    // Should the page never show up, the loading screen must not stay in the way.
    handler.postDelayed({ hideLoading() }, LOADING_LIMIT_MS)
  }

  /** Waits for the page to have something of its own to show, then takes the loading screen away. */
  private fun watchPage() {
    val view = webView
    if (loading == null || view == null) return
    val hasContent = "(function(){var r=document.getElementById('root');return !!(document.getElementById('splash')||(r&&r.childElementCount))})()"
    view.evaluateJavascript(hasContent) { result ->
      if (result == "true") {
        // Not before that content is ready to be drawn: otherwise a blank frame slips in between.
        view.postVisualStateCallback(loadingSince, object : WebView.VisualStateCallback() {
          override fun onComplete(requestId: Long) = hideLoading()
        })
      } else handler.postDelayed({ watchPage() }, 50L)
    }
  }

  private fun hideLoading() {
    val screen = loading ?: return
    loading = null
    screen.animate().alpha(0f).setDuration(200L).withEndAction {
      loadingMotion.forEach { it.cancel() }
      loadingMotion.clear()
      (screen.parent as? ViewGroup)?.removeView(screen)
    }.start()
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    loadingMotion.forEach { it.cancel() }
    loadingMotion.clear()
    super.onDestroy()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleIncoming(intent)
  }

  private fun incomingDir(): File = File(cacheDir, "incoming")

  /** Removes copies of shared files older than 24 hours. */
  private fun cleanOldIncoming() {
    try {
      val limit = System.currentTimeMillis() - 24L * 60 * 60 * 1000
      incomingDir().listFiles()?.forEach { f ->
        if (f.isDirectory && f.lastModified() < limit) f.deleteRecursively()
      }
    } catch (e: Exception) {
      Log.w("SnowPDF", "Could not clean the incoming cache", e)
    }
  }

  /** Copies the PDFs received through "Abrir con" / "Compartir" into the cache and queues their paths. */
  private fun handleIncoming(intent: Intent?) {
    if (intent == null) return
    val uris = ArrayList<Uri>()
    when (intent.action) {
      Intent.ACTION_VIEW -> intent.data?.let { uris.add(it) }
      Intent.ACTION_SEND ->
        IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.let { uris.add(it) }
      Intent.ACTION_SEND_MULTIPLE ->
        IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.let { uris.addAll(it) }
      else -> return
    }
    if (uris.isEmpty()) return

    val stamp = System.currentTimeMillis()
    uris.forEachIndexed { i, uri ->
      try {
        val dir = File(incomingDir(), "$stamp-$i")
        dir.mkdirs()
        val target = File(dir, displayName(uri))
        val input = contentResolver.openInputStream(uri) ?: throw IllegalStateException("No stream for $uri")
        input.use { src -> target.outputStream().use { dst -> src.copyTo(dst) } }
        File(incomingDir(), "pending.txt").appendText(target.absolutePath + "\n")
      } catch (e: Exception) {
        Log.w("SnowPDF", "Could not import $uri", e)
      }
    }
  }

  private fun displayName(uri: Uri): String {
    var name: String? = null
    try {
      if (uri.scheme == "content") {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
          if (c.moveToFirst()) name = c.getString(0)
        }
      } else {
        name = uri.lastPathSegment
      }
    } catch (e: Exception) {
      Log.w("SnowPDF", "Could not read the name of $uri", e)
    }
    var clean = (name ?: "documento.pdf").replace('/', '_').replace(BACKSLASH, '_').trim()
    if (clean.isEmpty() || clean == "." || clean == "..") clean = "documento.pdf"
    if (!clean.lowercase().endsWith(".pdf")) clean += ".pdf"
    return clean
  }
}
