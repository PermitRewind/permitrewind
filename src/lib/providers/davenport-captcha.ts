/**
 * Optional invisible reCAPTCHA v2 solve for the City of Davenport iWorQ search.
 * The site key is public. The API key comes from the environment and is never hardcoded.
 * Detail pages do not use this.
 */

export const DAVENPORT_RECAPTCHA_SITEKEY = "6Les_AYkAAAAACw9NzcxkcDVfvExxeyw2KS1cao_";
export const DAVENPORT_PORTAL_PAGE = "https://portal.iworq.net/DAVENPORT/permits/600";

const POLL_MS = 3000;
const POLL_TRIES = 20;

type FetchImpl = typeof fetch;

function providerName(env: NodeJS.ProcessEnv): "2captcha" | "anticaptcha" {
  return env.DAVENPORT_CAPTCHA_PROVIDER?.trim().toLowerCase() === "anticaptcha" ? "anticaptcha" : "2captcha";
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function solve2Captcha(fetchImpl: FetchImpl, key: string, pageUrl: string, siteKey: string): Promise<string | null> {
  const submit = new URL("https://2captcha.com/in.php");
  submit.searchParams.set("key", key);
  submit.searchParams.set("method", "userrecaptcha");
  submit.searchParams.set("googlekey", siteKey);
  submit.searchParams.set("pageurl", pageUrl);
  submit.searchParams.set("invisible", "1");
  submit.searchParams.set("json", "1");
  const created = await fetchImpl(submit, { cache: "no-store" });
  const body = (await created.json().catch(() => null)) as { status?: number; request?: string } | null;
  if (!body || body.status !== 1 || !body.request) return null;
  const id = body.request;
  for (let i = 0; i < POLL_TRIES; i++) {
    await sleep(POLL_MS);
    const poll = new URL("https://2captcha.com/res.php");
    poll.searchParams.set("key", key);
    poll.searchParams.set("action", "get");
    poll.searchParams.set("id", id);
    poll.searchParams.set("json", "1");
    const res = await fetchImpl(poll, { cache: "no-store" });
    const answer = (await res.json().catch(() => null)) as { status?: number; request?: string } | null;
    if (answer?.status === 1 && answer.request) return answer.request;
    if (answer?.request && answer.request !== "CAPCHA_NOT_READY") return null;
  }
  return null;
}

async function solveAntiCaptcha(fetchImpl: FetchImpl, key: string, pageUrl: string, siteKey: string): Promise<string | null> {
  const created = await fetchImpl("https://api.anti-captcha.com/createTask", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: key,
      task: { type: "RecaptchaV2TaskProxyless", websiteURL: pageUrl, websiteKey: siteKey, isInvisible: true },
    }),
  });
  const body = (await created.json().catch(() => null)) as { errorId?: number; taskId?: number } | null;
  if (!body || body.errorId || !body.taskId) return null;
  for (let i = 0; i < POLL_TRIES; i++) {
    await sleep(POLL_MS);
    const res = await fetchImpl("https://api.anti-captcha.com/getTaskResult", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: key, taskId: body.taskId }),
    });
    const answer = (await res.json().catch(() => null)) as {
      errorId?: number;
      status?: string;
      solution?: { gRecaptchaResponse?: string };
    } | null;
    if (answer?.errorId) return null;
    if (answer?.status === "ready" && answer.solution?.gRecaptchaResponse) return answer.solution.gRecaptchaResponse;
  }
  return null;
}

/** Returns a token when DAVENPORT_CAPTCHA_API_KEY is set. Otherwise null. */
export async function solveDavenportCaptcha(
  fetchImpl: FetchImpl = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const key = env.DAVENPORT_CAPTCHA_API_KEY?.trim();
  if (!key) return null;
  const pageUrl = DAVENPORT_PORTAL_PAGE;
  const siteKey = DAVENPORT_RECAPTCHA_SITEKEY;
  if (providerName(env) === "anticaptcha") return solveAntiCaptcha(fetchImpl, key, pageUrl, siteKey);
  return solve2Captcha(fetchImpl, key, pageUrl, siteKey);
}
