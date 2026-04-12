const BASE = "https://enforcedata.dol.gov/api";

export async function osha(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "X-API-KEY": process.env.DOL_API_KEY || "" },
  });
  if (!res.ok) throw new Error(`DOL/OSHA API ${res.status}: ${await res.text()}`);
  return res.json();
}
