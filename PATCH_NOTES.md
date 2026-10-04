Report PDF export/email update

Changed:
- backend/src/controllers/reportController.js
- backend/src/services/reportPdfService.js

Behavior:
1. Summarise ON + Group By:
   - pivot grouped bar chart
   - pivot grouped summary table with merged/repeated group cells
   - group-by detail tables tied to the summary groups
   - filtered raw dump with Share explanation and clickable proof links
2. Summarise OFF + Group By:
   - group-by detail tables
   - filtered raw dump with Share explanation and clickable proof links
3. Summarise OFF + no Group By:
   - filtered raw dump with Share explanation and clickable proof links
4. Selected sort order is applied to PDF detail/raw tables and the summary remains in backend-selected sort order.

The existing report query/UI behavior is not changed; the richer data is fetched only for PDF export/email.
