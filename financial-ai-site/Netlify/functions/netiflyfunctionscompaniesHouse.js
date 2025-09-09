import fetch from "node-fetch";

export async function handler(event) {
  const companyNumber = event.queryStringParameters.company;

  if (!companyNumber) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing company number" })
    };
  }

  const apiKey = process.env.COMPANIES_HOUSE_API_KEY; // stored in Netlify

  try {
    const response = await fetch(
      `https://api.company-information.service.gov.uk/company/${companyNumber}`,
      {
        headers: {
          Authorization: "Basic " + Buffer.from(apiKey + ":").toString("base64")
        }
      }
    );

    if (!response.ok) {
      throw new Error("Companies House API error: " + response.statusText);
    }

    const data = await response.json();

    return {
      statusCode: 200,
      body: JSON.stringify(data)
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to fetch from Companies House" })
    };
  }
}
