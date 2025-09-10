import fetch from "node-fetch";

export async function handler(event) {
  try {
    const companyNumber = event.queryStringParameters.company;
    if (!companyNumber) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing company number" }) };
    }

    const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    const authHeader = "Basic " + Buffer.from(apiKey + ":").toString("base64");

    const url = `https://api.company-information.service.gov.uk/company/${companyNumber}`;
    const response = await fetch(url, { headers: { Authorization: authHeader } });

    if (!response.ok) {
      return { statusCode: response.status, body: JSON.stringify({ error: "Companies House API error" }) };
    }

    const data = await response.json();
    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (err) {
    console.error("Error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error" }) };
  }
}
