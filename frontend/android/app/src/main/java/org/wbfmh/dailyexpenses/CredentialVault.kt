package org.wbfmh.dailyexpenses

import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.credentials.CreatePasswordRequest
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPasswordOption
import androidx.credentials.PasswordCredential
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.json.JSONObject

class CredentialVault(
    private val activity: MainActivity,
    private val webView: WebView,
) {
    private val credentialManager = CredentialManager.create(activity)

    @JavascriptInterface
    fun isAvailable(): Boolean {
        return true
    }

    @JavascriptInterface
    fun savePassword(username: String, password: String) {
        if (username.isBlank() || password.isBlank()) {
            return
        }

        activity.lifecycleScope.launch {
            try {
                val request = CreatePasswordRequest(
                    id = username.trim(),
                    password = password,
                )

                credentialManager.createCredential(
                    context = activity,
                    request = request,
                )
            } catch (_: Exception) {
                // Credential Manager errors must not interfere with the
                // application's existing login flow.
            }
        }
    }

    @JavascriptInterface
    fun getPassword(callbackName: String) {
        if (!isSafeCallbackName(callbackName)) {
            return
        }

        activity.lifecycleScope.launch {
            try {
                val passwordOption = GetPasswordOption()

                val request = GetCredentialRequest.Builder()
                    .addCredentialOption(passwordOption)
                    .build()

                val result = credentialManager.getCredential(
                    context = activity,
                    request = request,
                )

                val credential = result.credential

                if (credential is PasswordCredential) {
                    sendResult(
                        callbackName,
                        JSONObject()
                            .put("success", true)
                            .put(
                                "credential",
                                JSONObject()
                                    .put("username", credential.id)
                                    .put("password", credential.password),
                            ),
                    )
                } else {
                    sendResult(
                        callbackName,
                        JSONObject()
                            .put("success", false)
                            .put("credential", JSONObject.NULL),
                    )
                }
            } catch (_: Exception) {
                sendResult(
                    callbackName,
                    JSONObject()
                        .put("success", false)
                        .put("credential", JSONObject.NULL),
                )
            }
        }
    }

    private fun sendResult(
        callbackName: String,
        result: JSONObject,
    ) {
        activity.runOnUiThread {
            webView.evaluateJavascript(
                "$callbackName(${result});",
                null,
            )
        }
    }

    private fun isSafeCallbackName(value: String): Boolean {
        return value.matches(
            Regex("^[A-Za-z_$][A-Za-z0-9_$]*$"),
        )
    }
}
