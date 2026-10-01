import React, { useState } from "react";
import { CheckCircle2, Download, FileSpreadsheet, RotateCcw, UploadCloud } from "lucide-react";
import { api, showToast } from "../lib/api";

function downloadCsv(name, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
const expenseTemplate = [
  "date,category,item,quantity,unit,price,total_cost,expense_type,shares,comment,added_by,added_on,proof_google_docs_id,contract_download_url",
  '"2026,09,30",Food,Breakfast,10,piece,1000,1000,cash,"Arun Kumar|600,Bipin Das|~","Morning food",operator@example.com,2026-09-30T10:00:00Z,GOOGLE_DRIVE_IMAGE_DOCUMENT_ID,',
].join("\n");
const categoryItemTemplate = [
  "Food,Medicines,Medical",
  "Breakfast,Paracetamol,Doctor visiting",
  "Dinner,Vitamin tablets,Medical Test",
  "Lunch,,Physiotherapy",
].join("\n");

export default function BulkUpload({ type }) {
  const isExpenses = type === "expenses";
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState([]);
  const submit = async (event) => {
    event.preventDefault();
    if (!file) {
      showToast("warning", "Please choose a CSV file.");
      return;
    }
    setMessage("");
    setError("");
    setWarnings([]);
    try {
      const data = new FormData();
      data.append("file", file);
      const result = await api(
        isExpenses ? "/bulk-upload/expenses" : "/bulk-upload/categories-items",
        {
          method: "POST",
          body: data,
          loadingMessage: isExpenses
            ? "Importing expenses from CSV…"
            : "Importing categories and items…",
          toast: {
            type: "success",
            message: isExpenses
              ? "Expense CSV import completed."
              : "Categories and items CSV import completed.",
          },
        },
      );
      if (isExpenses) {
        setMessage(`Imported ${result.imported} expense(s); skipped ${result.skipped}.`);
        setWarnings(result.warnings || []);
      } else
        setMessage(`Imported ${result.categories} category column(s) and ${result.items} item(s).`);
      setFile(null);
      event.target.reset();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>{isExpenses ? "Bulk Upload Expenses" : "Bulk Upload Categories & Items"}</h1>
          <p>
            {isExpenses
              ? "Import expenses using the predefined CSV format."
              : "Each CSV column is a category; values below it are its items."}
          </p>
        </div>
      </div>
      <div className="card upload-instructions">
        <div className="feature-icon">
          <FileSpreadsheet size={24} />
        </div>
        {isExpenses ? (
          <>
            <h3>Expense CSV format</h3>
            <p>
              Use date as <code>yyyy,mm,dd</code> (quoted when it is one CSV field),
              price/total_cost, and shares such as{" "}
              <code>Survivor Name|600,Other Survivor|25%,Last Survivor|~</code>.
            </p>
            <p>
              Amounts and percentages are converted to database share amounts. Unknown survivor
              names are skipped individually. A <code>~</code> share receives the remaining amount.
              For <code>item</code>, an existing item for the category is stored in the item column;
              otherwise the value is automatically stored as <code>other_item</code>. The{" "}
              <code>other_item</code> CSV column is optional. The <code>comment</code> column is
              imported into the expense comment. Put a Google Drive image/file ID in{" "}
              <code>proof_google_docs_id</code>; the importer downloads it, converts an image to PDF
              when needed, and uploads the PDF to S3. The Drive file must be accessible to the
              backend.
            </p>
            <button
              type="button"
              className="secondary"
              onClick={() => downloadCsv("expenses-template.csv", expenseTemplate)}
            >
              <Download size={17} /> Download predefined CSV
            </button>
          </>
        ) : (
          <>
            <h3>Category / item CSV format</h3>
            <p>
              The first row contains category names. Every value below a category is an item for
              that category.
            </p>
            <button
              type="button"
              className="secondary"
              onClick={() => downloadCsv("categories-items-template.csv", categoryItemTemplate)}
            >
              <Download size={17} /> Download predefined CSV
            </button>
          </>
        )}
      </div>
      <form
        className="card form-stack"
        onSubmit={submit}
        onReset={() => {
          setFile(null);
          setMessage("");
          setError("");
          setWarnings([]);
        }}
      >
        <label>
          CSV file
          <input
            required
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>
        <div className="form-actions">
          <button className="primary" type="submit" disabled={!file}>
            <UploadCloud size={18} /> Upload CSV
          </button>
          <button className="secondary" type="reset">
            <RotateCcw size={17} /> Reset
          </button>
        </div>
      </form>
      {message ? (
        <div className="notice success-notice">
          <CheckCircle2 size={17} /> {message}
        </div>
      ) : null}
      {warnings.length ? (
        <div className="notice warning-notice">
          {warnings.map((warning, index) => (
            <div key={index}>{warning}</div>
          ))}
        </div>
      ) : null}
      {error ? <div className="notice error-notice">{error}</div> : null}
    </section>
  );
}
