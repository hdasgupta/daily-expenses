package org.wbfmh.dailyexpenses

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import com.getcapacitor.filesystem.FilesystemPlugin

class MainActivity : BridgeActivity() {

    private var credentialVault: CredentialVault? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        // Explicitly register the Filesystem plugin for the Android bridge.
        // This keeps PDF export working even when the generated Capacitor
        // plugin registration is stale in an existing Android project.
        registerPlugin(FilesystemPlugin::class.java)

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
