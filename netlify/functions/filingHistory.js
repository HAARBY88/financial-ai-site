export async function handler(event) {
  const fetch = (await import('node-fetch')).default;
  const companyNumber = event.queryStringParameters.company;

  if (!companyNumber) {
    return { statusCode: 400, body: JSON.stringify({ error: "Company number is required" }) };
  }

  try {
    const response = await fetch(
      `https://api.company-information.service.gov.uk/company/${companyNumber}/filing-history?items_per_page=50`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(process.env.COMPANIES_HOUSE_KEY + ":").toString("base64")}`
        }
      }
    );

    const data = await response.json();

    // Filter, sort, and limit to last 20 accounts filings
    const filings = data.items
      .filter(f => (f.type && f.type.toLowerCase().includes("accounts")) ||
                   (f.description && f.description.toLowerCase().includes("accounts")))
      .sort((a,b) => new Date(b.date) - new Date(a.date))
      .slice(0, 20);

    return {
      statusCode: 200,
      body: JSON.stringify({ items: filings })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
}
