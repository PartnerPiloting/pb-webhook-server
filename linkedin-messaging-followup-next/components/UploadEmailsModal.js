"use client";

import React, { useCallback, useState } from "react";
import { XMarkIcon, ClipboardDocumentIcon, ArrowUpTrayIcon } from "@heroicons/react/24/outline";
import { fetchBlankEmailProfileUrls, uploadLeadEmailsCsv } from "../services/api.js";

/**
 * Owner-only (Guy-Wilson): copy blank-email profile URLs for LinkedHelper; upload CSV to backfill emails.
 */
export default function UploadEmailsModal({ isOpen, onClose }) {
  const [urlsLoading, setUrlsLoading] = useState(false);
  const [urlsError, setUrlsError] = useState("");
  const [urlsResult, setUrlsResult] = useState(null);

  const [file, setFile] = useState(null);
  const [applyCsv, setApplyCsv] = useState(true);
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvError, setCsvError] = useState("");
  const [csvResult, setCsvResult] = useState(null);

  const resetCopyState = useCallback(() => {
    setUrlsError("");
    setUrlsResult(null);
  }, []);

  const resetCsvState = useCallback(() => {
    setCsvError("");
    setCsvResult(null);
  }, []);

  const handleLoadUrls = async () => {
    resetCopyState();
    setUrlsLoading(true);
    try {
      const data = await fetchBlankEmailProfileUrls();
      if (!data.success) throw new Error(data.error || "Request failed");
      setUrlsResult({
        total: data.total,
        truncated: !!data.truncated,
        urls: data.urls || [],
      });
    } catch (e) {
      setUrlsError(e.message || String(e));
    } finally {
      setUrlsLoading(false);
    }
  };

  const handleCopyUrls = async () => {
    if (!urlsResult?.urls?.length) return;
    const text = urlsResult.urls.join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("Copy these URLs (Ctrl+C):", text);
    }
  };

  const handleCsvUpload = async () => {
    resetCsvState();
    if (!file) {
      setCsvError("Choose a CSV or Excel file first.");
      return;
    }
    setCsvLoading(true);
    try {
      const data = await uploadLeadEmailsCsv(file, { apply: applyCsv, previewMax: 30 });
      if (data.success === false) throw new Error(data.error || "Upload failed");
      setCsvResult(data);
    } catch (e) {
      setCsvError(e.message || String(e));
    } finally {
      setCsvLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto border border-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Upload Emails</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-gray-500 hover:bg-gray-100"
            aria-label="Close"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-8">
          <section>
            <h3 className="text-sm font-medium text-gray-800 mb-1">
              1. Copy profile URLs (blank emails)
            </h3>
            <p className="text-xs text-gray-600 mb-3">
              For LinkedHelper Email Finder: loads every lead with an empty Email and a LinkedIn URL, then you can copy all URLs at once.
            </p>
            <button
              type="button"
              disabled={urlsLoading}
              onClick={handleLoadUrls}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg disabled:opacity-50"
            >
              {urlsLoading ? "Loading…" : "Load URLs from Airtable"}
            </button>
            {urlsLoading && (
              <p className="mt-2 text-sm text-gray-600">Fetching leads… this can take up to a minute for large bases.</p>
            )}
            {urlsError && <p className="mt-2 text-sm text-red-600">{urlsError}</p>}
            {urlsResult && (
              <div className="mt-3 rounded-lg bg-gray-50 border border-gray-100 p-3 text-sm">
                <p className="font-medium text-gray-800">
                  {urlsResult.total} profile{urlsResult.total === 1 ? "" : "s"} ready to copy
                  {urlsResult.truncated ? " (list capped at 25,000 — contact dev if you need more)" : ""}
                </p>
                {urlsResult.total > 0 && (
                  <button
                    type="button"
                    onClick={handleCopyUrls}
                    className="mt-2 inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg"
                  >
                    <ClipboardDocumentIcon className="h-5 w-5" />
                    Copy all URLs
                  </button>
                )}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-sm font-medium text-gray-800 mb-1">2. Upload emails from CSV</h3>
            <p className="text-xs text-gray-600 mb-3">
              Two columns: LinkedIn profile URL and email (headers like <code className="bg-gray-100 px-1 rounded">LinkedIn Profile URL</code> /{" "}
              <code className="bg-gray-100 px-1 rounded">Email</code> or <code className="bg-gray-100 px-1 rounded">profile_url</code> /{" "}
              <code className="bg-gray-100 px-1 rounded">email</code>). Excel (.xlsx) is also supported. Only rows with a valid email update leads
              where Email is currently blank.
            </p>
            <label className="block">
              <span className="sr-only">Choose file</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-gray-100 file:text-gray-800 hover:file:bg-gray-200"
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null);
                  resetCsvState();
                }}
              />
            </label>
            <label className="mt-3 flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={applyCsv} onChange={(e) => setApplyCsv(e.target.checked)} className="rounded border-gray-300" />
              Write matching emails to Airtable (uncheck for preview only)
            </label>
            <button
              type="button"
              disabled={csvLoading || !file}
              onClick={handleCsvUpload}
              className="mt-3 inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-lg disabled:opacity-50"
            >
              <ArrowUpTrayIcon className="h-5 w-5" />
              {csvLoading ? "Processing…" : applyCsv ? "Upload & apply" : "Preview upload"}
            </button>
            {csvError && <p className="mt-2 text-sm text-red-600">{csvError}</p>}
            {csvResult && (
              <div className="mt-3 rounded-lg bg-gray-50 border border-gray-100 p-3 text-sm space-y-1 text-gray-800">
                <p>
                  <span className="font-medium">Matched leads (blank email + URL in file):</span> {csvResult.matchedLeads ?? "—"}
                </p>
                <p>
                  <span className="font-medium">Rows applied:</span> {csvResult.applied ?? 0}
                  {csvResult.apply === false && " (dry run — no writes)"}
                </p>
                {Array.isArray(csvResult.warnings) && csvResult.warnings.length > 0 && (
                  <p className="text-amber-800 text-xs mt-2">{csvResult.warnings.join(" ")}</p>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
