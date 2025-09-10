import fetch from "node-fetch";

export async function handler(event) {
  const companyNumber = event.queryStringParameters.company;

  if (!companyNumber) {
    return { statusCode: 400, body: JSON.stringify({ error: "Company number is required" }) };
  }

  try {
    const response = await fetch(`https://api.company-information.service.gov.uk/company/${companyNumber}/filing-history?items_per_page=50`, {
      headers: {
        Authorization: `Basic ${Buffer.from(process.env.COMPANIES_HOUSE_KEY + ":").toString("base64")}`
      }
    });

    const data = await response.json();

    return {
      statusCode: 200,
      body: JSON.stringify(data)
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
}
