const ensureFetch = () => {
  if (typeof fetch !== "function") {
    throw new Error("This script requires Node 18+ with global fetch.");
  }
};

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
};

const createClient = (baseUrl) => {
  ensureFetch();
  let cookie = null;

  const request = async (path, options = {}) => {
    const headers = { ...(options.headers || {}) };
    if (cookie) {
      headers.Cookie = cookie;
    }

    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
    });

    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      cookie = setCookie.split(";")[0];
    }

    const text = await res.text();
    const body = parseJson(text);

    return { status: res.status, body, text };
  };

  const getCsrf = async () => {
    const res = await request("/api/v1/auth/csrf", { method: "GET" });
    if (!res.body || !res.body.token) {
      throw new Error(`CSRF token missing: ${res.text}`);
    }
    return res.body.token;
  };

  return { request, getCsrf };
};

module.exports = { createClient };
