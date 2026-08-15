/**
 * توليد الأرقام التسلسلية بشكل ذرّي داخل معاملة.
 *
 * UPDATE ... RETURNING على صف العدّاد يقفل الصف، فلو ضغط موظفان "حفظ" في نفس اللحظة
 * انتظر الثاني حتى ينتهي الأول ⇒ لا رقمان متطابقان أبدًا.
 * وإذا فشلت المعاملة يُلغى الحجز ⇒ لا فجوات في الترقيم.
 */
export async function nextSequence(client, scope, year) {
  const y = Number(year) || new Date().getFullYear();
  const { rows } = await client.query(
    `INSERT INTO counters (scope, year, value) VALUES ($1, $2, 1)
     ON CONFLICT (scope, year) DO UPDATE SET value = counters.value + 1
     RETURNING value`,
    [scope, y]
  );
  return rows[0].value;
}

export const pad = (n, width = 6) => String(n).padStart(width, '0');

export async function nextStudentNumber(client, year, prefix = 'STU') {
  const n = await nextSequence(client, 'student', year);
  return `${prefix}-${year}-${pad(n)}`;
}

export async function nextReceiptNumber(client, year, prefix = 'SHW') {
  const n = await nextSequence(client, 'receipt', year);
  return `${prefix}-${year}-${pad(n)}`;
}

export default { nextSequence, nextStudentNumber, nextReceiptNumber, pad };
