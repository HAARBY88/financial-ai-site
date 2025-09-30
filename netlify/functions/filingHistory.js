// netlify/functions/filingHistory.js
import fetch from "node-fetch";

function basicAuthHeader() {
  const key = process.env.COMPANIES_HOUSE_API_KEY || process.env.COMPANIES_HOUSE_KEY;
  if (!key) throw new Error("Missing COMPANIES_HOUSE_API_KEY");
  return "Basic " + Buffer.from(key + ":").toString("base64");
}

// Build a human-readable title from description + description_values
function prettyDescription(item) {
  const d = item.description || "Accounts filing";
  const v = item.description_values || {};
  // Common keys: made_up_date, category, type etc.
  // Compose something friendly, falling back gracefully:
  const madeUp = v.made_up_date ? `made up to ${v.made_up_date}` : "";
  // If the raw description is like "accounts-with-accounts-type-group", try a nicer label:
  let base =
    v.accounts_type ||
    v.category ||
    d.replace(/accounts-with-accounts-type-/, "").replace(/-/g, " ");

  base = base
    ? base.charAt(0).toUpperCase() + base.slice(1)
    : "Accounts";

  return [base, madeUp].filter(Boolean).join(" ");
}

async function getPdfUrl(documentId) {
  // Step 2: document metadata
  const metaRes = await fetch(
    `https://document-api.company-information.service.gov.uk/document/${documentId}`,
    { headers: { Authorization: basicAuthHeader() } }
  );

  if (!metaRes.ok) return null;
  const meta = await metaRes.json();

  // Check for PDF
  const hasPdf = meta?.resources && meta.resources["application/pdf"];
  if (!hasPdf) return null;

  // Step 3: ask for content with Accept: application/pdf to receive 302 Location
  const contentRes = await fetch(
    `https://document-api.company-information.service.gov.uk/document/${documentId}/content`,
    {
      method: "GET",
      headers: {
        Authorization: basicAuthHeader(),
        Accept: "application/pdf",
      },
      // We want to read the redirect target instead of auto-following
      redirect: "manual",
    }
  );

  // Expect 302 with Location header
  if (contentRes.status === 302) {
    const pdfUrl = contentRes.headers.get("location");
    return pdfUrl || null;
  }

  // Some environments might auto-follow; try to use final URL if present
  if (contentRes.ok) {
    // As a fallback (not typical), you could stream the body to a temp file here.
    return null;
  }

  return null;
}

export async function handler(event) {
  try {
    const companyNumber = event.queryStringParameters?.company;
    if (!companyNumber) {
      return { statusCode: 400, body: JSON.stringify({ error: "company is required" }) };
    }

    // Step 1: filing history
    const fhRes = await fetch(
      `https://api.company-information.service.gov.uk/company/${companyNumber}/filing-history?items_per_page=50`,
      { headers: { Authorization: basicAuthHeader() } }
    );

    if (!fhRes.ok) {
      const txt = await fhRes.text();
      return { statusCode: fhRes.status, body: txt };
    }

    const fh = await fhRes.json();
    const items = Array.isArray(fh.items) ? fh.items : [];

    // Keep only "accounts" filings
    const accountFilings = items.filter(
      (f) => (f.description || "").toLowerCase().includes("accounts")
    );

    const results = [];
    for (const f of accountFilings) {
      // Need a document_id: it usually comes from links.document_metadata
      const docMetaPath = f?.links?.document_metadata; // e.g. "/document/<id>"
      const docId = docMetaPath ? docMetaPath.split("/").filter(Boolean).pop() : null;

      const title = prettyDescription(f);
      const date = f.date || null;

      if (!docId) {
        // No API-downloadable doc — include a viewer link for the user
        results.push({
          date,
          title,
          documentId: null,
          pdfUrl: null,
          viewerUrl: `https://find-and-update.company-information.service.gov.uk/company/${companyNumber}/filing-history/${f.transaction_id}`,
          downloadable: false,
        });
        continue;
      }

      // Try to get a real PDF URL
      const pdfUrl = await getPdfUrl(docId);

      results.push({
        date,
        title,
        documentId: docId,
        pdfUrl, // if null, the API doesn’t expose a PDF for this filing
        viewerUrl: `https://find-and-update.company-information.service.gov.uk/company/${companyNumber}/filing-history/${f.transaction_id}`,
        downloadable: !!pdfUrl,
      });
    }

    // Sort newest first
    results.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    return {
      statusCode: 200,
      body: JSON.stringify({ items: results }),
    };
  } catch (err) {
    console.error("filingHistory error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}








