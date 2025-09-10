const fetch = require("node-fetch");

exports.handler = async function(event) {
  const companyNumber = event.queryStringParameters?.company;
  if (!companyNumber) {
    return { statusCode: 400, body: JSON.stringify({ error: "Company number is required" }) };
  }

  try {
    const url = `https://api.company-information.service.gov.uk/company/${companyNumber}`;
    const headers = {
      Authorization: `Basic ${Buffer.from(process.env.COMPANIES_HOUSE_KEY + ":").toString("base64")}`,
      Accept: "application/json"
    };

    const response = await fetch(url, { headers });
    const rawText = await response.text();

    if (!response.ok) {
      return { statusCode: response.status, body: JSON.stringify({ error: `API request failed`, details: rawText }) };
    }

    const data = JSON.parse(rawText);

    const companyInfo = {
      company_name: data.company_name,
      company_number: data.company_number,
      company_status: data.company_status,
      type: data.type,
      date_of_creation: data.date_of_creation,
      registered_office_address: data.registered_office_address || {},
      accounts: data.accounts || {},
      confirmation_statement: data.confirmation_statement || {},
      links: data.links
    };

    return { statusCode: 200, body: JSON.stringify(companyInfo) };

  } catch (err) {
    console.error("Error fetching company:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};


