package org.wbfmh.dailyexpenses

import android.os.Bundle
import android.webkit.WebView
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {

    private var credentialVault: CredentialVault? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        bridge.webView?.let { webView ->
            credentialVault = CredentialVault(
                activity = this,
                webView = webView,
            )

            webView.settings.javaScriptEnabled = true

            webView.addJavascriptInterface(
                credentialVault,
                "DailyExpensesCredentialVault",
            )
        }
    }

    override fun onDestroy() {
        bridge.webView?.removeJavascriptInterface(
            "DailyExpensesCredentialVault",
        )

        credentialVault = null

        super.onDestroy()
    }
}
