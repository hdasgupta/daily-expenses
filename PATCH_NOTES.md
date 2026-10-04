Corrected admin failure alert patch.

Important fix:
- backend/src/services/adminAlertService.js no longer imports a nonexistent sendAdminFailureAlert export from mailService.js.
- The service now implements and exports sendAdminFailureAlert itself, using the existing EMAIL_API_URL, EMAIL_API_KEY, and ADMIN_EMAIL configuration.
- notifyAdminFailure remains non-throwing so an alert-delivery failure cannot crash the application.

Apply the files in this archive over the existing repository while preserving the folder structure.
