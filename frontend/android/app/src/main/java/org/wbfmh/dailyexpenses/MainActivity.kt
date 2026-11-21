package org.wbfmh.dailyexpenses

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {

    private var credentialVault: CredentialVault? = null
    private var speechBridge: AndroidSpeechBridge? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val webView = bridge.webView ?: return

        val vault = CredentialVault(
            activity = this,
            webView = webView,
        )
        credentialVault = vault

        val speech = AndroidSpeechBridge(
            activity = this,
            webView = webView,
        )
        speechBridge = speech

        webView.settings.javaScriptEnabled = true

        webView.addJavascriptInterface(
            vault,
            "DailyExpensesCredentialVault",
        )
        webView.addJavascriptInterface(
            speech,
            "DailyExpensesSpeech",
        )
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        if (speechBridge?.onPermissionResult(requestCode, grantResults) == true) {
            return
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    }

    override fun onDestroy() {
        bridge.webView?.removeJavascriptInterface(
            "DailyExpensesCredentialVault",
        )
        bridge.webView?.removeJavascriptInterface(
            "DailyExpensesSpeech",
        )

        credentialVault = null
        speechBridge?.destroy()
        speechBridge = null

        super.onDestroy()
    }
}
