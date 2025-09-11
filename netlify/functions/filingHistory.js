import fetch from "node-fetch";

export async function handler(event) {
  const companyNumber = event.queryStringParameters.company;

  if (!companyNumber) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Company number is required" })
    };
  }

  try {
    // ✅ Correct Basic Auth header
    const authHeader =
      "Basic " +
      Buffer.from(`${process.env.COMPANIES_HOUSE_KEY}:`).toString("base64");

    const response = await fetch(
      `https://api.company-information.service.gov.uk/company/${companyNumber}/filing-history?items_per_page=10`,
      {
        headers: { Authorization: authHeader }
      }
    );

    console.log("Filing history status:", response.status);

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("Raw filing response text:", text);
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: "Non-JSON response from API" })
      };
    }

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: data.error || "API request failed" })
      };
    }

    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}



