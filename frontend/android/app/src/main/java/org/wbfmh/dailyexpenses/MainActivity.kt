package org.wbfmh.dailyexpenses

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {

    private var credentialVault: CredentialVault? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(FileCachePlugin::class.java)
        super.onCreate(savedInstanceState)

        val webView = bridge.webView ?: return

        val vault = CredentialVault(
            activity = this,
            webView = webView,
        )

        credentialVault = vault

        webView.settings.javaScriptEnabled = true

        webView.addJavascriptInterface(
            vault,
            "DailyExpensesCredentialVault",
        )
    }

    override fun onDestroy() {
        bridge.webView?.removeJavascriptInterface(
            "DailyExpensesCredentialVault",
        )

        credentialVault = null

        super.onDestroy()
    }
}
