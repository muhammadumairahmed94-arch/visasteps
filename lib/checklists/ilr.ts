/**
 * Indefinite Leave to Remain — varies by route. Checked against GOV.UK on 19 Oct 2026:
 * gov.uk/indefinite-leave-to-remain-tier-2-t2-skilled-worker-visa, gov.uk/indefinite-leave-to-remain.
 */
export const ilr = {
  name: "Indefinite Leave to Remain (ILR)",
  extraFolders: ["07 Translations", "08 Correspondence"],
  retiredKeys: ["P60"],
  items: [
    { folder: "01 Identity", groupLabel: "Identity", title: "Passport", typeKey: "Passport", required: true,
      why: "A clear photo of the personal details page." },
    { folder: "01 Identity", groupLabel: "Identity", title: "Current UK visa or eVisa", typeKey: "Current-visa", required: true,
      why: "Residence permit (both sides) or the eVisa share code." },
    { folder: "02 Knowledge and English", groupLabel: "Knowledge and English", title: "Life in the UK test pass", typeKey: "Life-in-UK", required: true,
      why: "The pass notification letter or reference number. Needed for applicants aged 18 to 64." },
    { folder: "02 Knowledge and English", groupLabel: "Knowledge and English", title: "English language evidence", typeKey: "English", required: false,
      why: "For partner routes: level B1 or higher. Skilled Workers do not need to prove English again." },
    { folder: "03 Residence", groupLabel: "Residence", title: "Absences from the UK", typeKey: "Absences", required: true,
      why: "Every trip outside the UK in the qualifying period (usually 5 years), with dates. A simple table is fine." },
    { folder: "03 Residence", groupLabel: "Residence", title: "Previous visas", typeKey: "Previous-visas", required: false,
      why: "Earlier UK visas or residence permits covering the qualifying period." },
    { folder: "04 Work and finances", groupLabel: "Work and finances", title: "Employer's letter", typeKey: "Employer-letter", required: false,
      why: "For Skilled Workers: confirms the job is still needed and the salary meets the requirements." },
    { folder: "04 Work and finances", groupLabel: "Work and finances", title: "Payslips and bank statements", typeKey: "Payslip", required: false,
      why: "For work and partner routes: recent payslips with the bank statements showing them paid in. The caseworker will confirm the period." },
    { folder: "05 Partner route", groupLabel: "Partner route", title: "Evidence of living together", typeKey: "Living-together", required: false,
      why: "For partner routes: letters or bills to both at the same address across the period." },
    { folder: "05 Partner route", groupLabel: "Partner route", title: "Partner's British passport or status", typeKey: "Partner-passport", required: false,
      why: "For partner routes: the partner's British passport photo page or proof of settled status." },
  ],
};
