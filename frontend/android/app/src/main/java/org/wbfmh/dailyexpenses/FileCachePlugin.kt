package org.wbfmh.dailyexpenses

import android.content.Intent
import android.util.Base64
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.PluginMethod
import java.io.File

@CapacitorPlugin(name = "FileCache")
class FileCachePlugin : Plugin() {

    @PluginMethod
    fun cacheAndOpen(call: PluginCall) {
        val fileName = sanitizeFileName(call.getString("fileName") ?: "expense-report.pdf")
        val data = call.getString("data")
        val mimeType = call.getString("mimeType") ?: "application/octet-stream"

        if (data.isNullOrBlank()) {
            call.reject("File data is empty.")
            return
        }

        try {
            val cacheDirectory = File(context.cacheDir, "daily-expenses-files")
            if (!cacheDirectory.exists() && !cacheDirectory.mkdirs()) {
                call.reject("Unable to create the file cache directory.")
                return
            }

            val file = File(cacheDirectory, fileName)
            val bytes = Base64.decode(data, Base64.DEFAULT)
            file.writeBytes(bytes)

            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                file,
            )

            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mimeType)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            val resolver = context.packageManager
            if (intent.resolveActivity(resolver) == null) {
                call.reject("No installed application can open this file.")
                return
            }

            context.startActivity(intent)

            call.resolve(JSObject().apply {
                put("uri", uri.toString())
                put("fileName", fileName)
            })
        } catch (error: Exception) {
            call.reject(error.message ?: "Unable to cache and open the file.", error)
        }
    }

    private fun sanitizeFileName(value: String): String {
        val sanitized = value
            .replace(Regex("[<>:\"/\\\\|?*\\u0000-\\u001F]"), "-")
            .replace(Regex("\\s+"), "-")
            .replace(Regex("-+"), "-")
            .trim('-')

        return if (sanitized.isBlank()) "expense-report.pdf" else sanitized
    }
}
