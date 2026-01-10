import { json } from "./_middleware";
export async function onRequestPost() {
  return json({ ok: true });
}
