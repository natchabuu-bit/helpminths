// Follow the public navigation exactly as a user would. Legacy labels remain
// aliases so history/clinical suites continue to open their original content.
export function primaryNavigationItem(page, label) {
  if (label === 'ภาพรวม') return page.getByRole('button', { name: 'HelpMinths หน้าหลัก', exact: true })
  const names = { Dashboard: 'สถิติโรค', 'ประวัติการตรวจ': 'งานของฉัน' }
  return page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }).getByRole('button', { name: names[label] || label, exact: true })
}

export async function navigate(page, label) {
  if (label === 'ตั้งค่าและบัญชี' || label === 'ตั้งค่า') {
    const account = page.getByRole('button', { name: /^(บัญชีของฉัน|เข้าสู่ระบบหรือสมัครสมาชิก)$/ })
    await account.waitFor()
    if (await account.getAttribute('aria-expanded') !== 'true') await account.click()
    await page.getByRole('region', { name: 'เมนูบัญชี', exact: true }).getByRole('button', { name: 'ตั้งค่า', exact: true }).click()
    return
  }
  if (label === 'ประเมินและเสนอแนะ') {
    await page.locator('footer.app-footer').getByRole('link', { name: label, exact: true }).click()
    await page.getByRole('heading', { name: 'ประเมินการใช้งาน', exact: true }).waitFor()
    return
  }
  if (['ทบทวนโดยผู้เชี่ยวชาญ', 'รายงาน', 'ประเมินโมเดล'].includes(label)) {
    const manage = page.getByRole('button', { name: 'จัดการ', exact: true })
    await manage.waitFor()
    if (await manage.getAttribute('aria-expanded') !== 'true') await manage.click()
    await page.getByRole('region', { name: 'เมนูจัดการ', exact: true }).getByRole('button', { name: label, exact: true }).click()
    return
  }
  await primaryNavigationItem(page, label).click()
  if (label === 'ประวัติการตรวจ') await page.getByRole('tab', { name: 'ประวัติการตรวจ', exact: true }).click()
}
