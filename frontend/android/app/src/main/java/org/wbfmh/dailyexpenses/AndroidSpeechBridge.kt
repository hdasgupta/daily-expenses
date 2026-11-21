package org.wbfmh.dailyexpenses

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

class AndroidSpeechBridge(
    private val activity: Activity,
    private val webView: WebView,
) {
    companion object {
        const val REQUEST_RECORD_AUDIO = 9412
    }

    private var speechRecognizer: SpeechRecognizer? = null
    private var pendingLang: String? = null

    @JavascriptInterface
    fun isAvailable(): Boolean {
        return SpeechRecognizer.isRecognitionAvailable(activity)
    }

    @JavascriptInterface
    fun hasPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.RECORD_AUDIO,
        ) == PackageManager.PERMISSION_GRANTED
    }

    @JavascriptInterface
    fun startListening(lang: String?) {
        val targetLang = if (lang.isNullOrBlank()) "en-IN" else lang.trim()
        activity.runOnUiThread {
            if (!hasPermission()) {
                pendingLang = targetLang
                ActivityCompat.requestPermissions(
                    activity,
                    arrayOf(Manifest.permission.RECORD_AUDIO),
                    REQUEST_RECORD_AUDIO,
                )
                return@runOnUiThread
            }
            beginRecognition(targetLang)
        }
    }

    @JavascriptInterface
    fun stopListening() {
        activity.runOnUiThread {
            try {
                speechRecognizer?.stopListening()
            } catch (_: Exception) {
                // Ignore stop errors
            }
        }
    }

    fun onPermissionResult(requestCode: Int, grantResults: IntArray): Boolean {
        if (requestCode != REQUEST_RECORD_AUDIO) return false
        val lang = pendingLang ?: "en-IN"
        pendingLang = null
        val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        if (granted) {
            activity.runOnUiThread { beginRecognition(lang) }
        } else {
            emitEvent("error", "not-allowed")
            emitEvent("end", "")
        }
        return true
    }

    private fun beginRecognition(lang: String) {
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
            emitEvent("error", "service-not-allowed")
            emitEvent("end", "")
            return
        }

        destroyRecognizer()

        val recognizer = SpeechRecognizer.createSpeechRecognizer(activity)
        speechRecognizer = recognizer

        recognizer.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                emitEvent("start", "")
            }

            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}

            override fun onEndOfSpeech() {
                emitEvent("end", "")
            }

            override fun onError(error: Int) {
                val code = when (error) {
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "not-allowed"
                    SpeechRecognizer.ERROR_NO_MATCH,
                    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
                    SpeechRecognizer.ERROR_NETWORK,
                    SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network"
                    SpeechRecognizer.ERROR_AUDIO -> "audio-capture"
                    else -> "speech-error"
                }
                emitEvent("error", code)
                emitEvent("end", "")
            }

            override fun onResults(results: Bundle?) {
                val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                val best = matches?.firstOrNull()?.trim().orEmpty()
                if (best.isNotEmpty()) {
                    emitEvent("final", best)
                }
                emitEvent("end", "")
            }

            override fun onPartialResults(partialResults: Bundle?) {
                val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                val partial = matches?.firstOrNull()?.trim().orEmpty()
                if (partial.isNotEmpty()) {
                    emitEvent("interim", partial)
                }
            }

            override fun onEvent(eventType: Int, params: Bundle?) {}
        })

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }

        try {
            recognizer.startListening(intent)
        } catch (_: Exception) {
            emitEvent("error", "speech-error")
            emitEvent("end", "")
        }
    }

    private fun emitEvent(type: String, value: String) {
        val payload = JSONObject().apply {
            put("type", type)
            put("value", value)
        }.toString()
        webView.post {
            webView.evaluateJavascript(
                "window.__onNativeVoiceEvent && window.__onNativeVoiceEvent($payload);",
                null,
            )
        }
    }

    private fun destroyRecognizer() {
        try {
            speechRecognizer?.cancel()
            speechRecognizer?.destroy()
        } catch (_: Exception) {
            // Ignore cleanup errors
        }
        speechRecognizer = null
    }

    fun destroy() {
        activity.runOnUiThread {
            destroyRecognizer()
        }
    }
}
