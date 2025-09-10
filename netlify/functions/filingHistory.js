exports.handler = async function(event, context) {
  try {
    const { company } = event.queryStringParameters || {};
    if (!company) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing company number (?company=XXXX)" })
      };
    }

    const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "API key not configured in Netlify" })
      };
    }

    // Fetch filing history from Companies House
    const response = await fetch(
      `https://api.company-information.service.gov.uk/company/${company}/filing-history`,
      {
        headers: {
          Authorization: "Basic " + Buffer.from(apiKey + ":").toString("base64")
        }
      }
    );

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: "Companies House API error", status: response.status })
      };
    }

    const data = await response.json();

    return {
      statusCode: 200,
      body: JSON.stringify(data)
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unexpected server error", details: err.message })
    };
  }
};
