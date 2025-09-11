// companiesHouse.js
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
    // ✅ Build Basic Auth header correctly
    const authHeader =
      "Basic " +
      Buffer.from(`${process.env.COMPANIES_HOUSE_KEY}:`).toString("base64");

    // ✅ Request company profile
    const response = await fetch(
      `https://api.company-information.service.gov.uk/company/${companyNumber}`,
      {
        headers: {
          Authorization: authHeader
        }
      }
    );

    // Log response status for debugging
    console.log("Companies House status:", response.status);

    const text = await response.text();

    // Try to parse JSON, otherwise return error
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("Raw response text:", text);
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


