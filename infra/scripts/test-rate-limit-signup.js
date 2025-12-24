const { createClient } = require("./rate-limit-utils");

const baseUrl = process.env.API_BASE_URL || "http://localhost:3000";
const attempts = Number(process.env.ATTEMPTS || "6");
const email = `ratelimit+signup+${Date.now()}@example.com`;
const password = "Password123";

const run = async () => {
  const client = createClient(baseUrl);
  const results = [];

  for (let i = 1; i <= attempts; i += 1) {
    const csrf = await client.getCsrf();
    const res = await client.request("/api/v1/auth/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf,
      },
      body: JSON.stringify({ email, password }),
    });

    results.push({
      attempt: i,
      status: res.status,
      code: res.body?.code || null,
    });
  }

  const last = results[results.length - 1];
  const passed = last.status === 429 && last.code === "RATE_LIMITED";

  if (!passed) {
    console.error("Signup rate limit test failed.");
    console.error(JSON.stringify(results, null, 2));
    process.exit(1);
  }

  console.log("Signup rate limit test passed.");
  console.log(JSON.stringify(results, null, 2));
};

run().catch((error) => {
  console.error("Signup rate limit test crashed.");
  console.error(error);
  process.exit(1);
});
