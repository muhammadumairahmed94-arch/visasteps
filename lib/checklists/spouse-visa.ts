/**
 * Spouse or partner visa (from outside the UK). Checked against GOV.UK on 19 Oct 2026:
 * gov.uk/uk-family-visa/partner-spouse, /provide-information, /proof-income-partner, /knowledge-of-english, gov.uk/tb-test-visa.
 * Routes and items live in the database; this file seeds them and `npm run checklists:sync` updates them.
 */
export const spouseVisa = {
  name: "Spouse visa",
  extraFolders: ["07 Translations", "08 Correspondence"],
  retiredKeys: [] as string[],
  items: [
    { folder: "01 Identity", groupLabel: "Identity", title: "Passport", typeKey: "Passport", required: true,
      why: "A clear photo of the personal details page." },
    { folder: "01 Identity", groupLabel: "Identity", title: "Previous passports", typeKey: "Previous-passport", required: false,
      why: "The photo page and any visa or entry stamps from earlier passports." },
    { folder: "02 Relationship", groupLabel: "Relationship", title: "Marriage certificate", typeKey: "Marriage-certificate", required: true,
      why: "The full marriage or civil partnership certificate. Documents not in English need a certified translation; we can arrange one." },
    { folder: "02 Relationship", groupLabel: "Relationship", title: "Evidence of the relationship", typeKey: "Relationship-evidence", required: true,
      why: "Proof of living together or keeping in contact, such as joint bills, council tax, bank letters or call records. Official documents less than 4 years old are best." },
    { folder: "02 Relationship", groupLabel: "Relationship", title: "Photographs together", typeKey: "Photos-together", required: false,
      why: "A few photographs from different occasions, such as the wedding and visits." },
    { folder: "02 Relationship", groupLabel: "Relationship", title: "Divorce or death certificate", typeKey: "Previous-marriage", required: false,
      why: "Only if either of you was married before: proof the earlier marriage ended." },
    { folder: "03 Finances", groupLabel: "Finances", title: "Sponsor's payslips", typeKey: "Payslip", required: true,
      why: "6 months of payslips, counting back from the date of application. The income requirement is usually £29,000 a year." },
    { folder: "03 Finances", groupLabel: "Finances", title: "Sponsor's bank statements", typeKey: "Bank-statement", required: true,
      why: "Statements for the same 6 months, showing each salary payment going in." },
    { folder: "03 Finances", groupLabel: "Finances", title: "Employer's letter", typeKey: "Employer-letter", required: true,
      why: "Dated, on headed paper: job, start date, contract type, salary before tax, how long it has been paid, and that the payslips are genuine." },
    { folder: "03 Finances", groupLabel: "Finances", title: "Other income or savings", typeKey: "Other-income", required: false,
      why: "Only if relying on self-employment, savings over £16,000, pension or rental income. The caseworker will confirm what is needed." },
    { folder: "04 Accommodation", groupLabel: "Accommodation", title: "Tenancy or mortgage", typeKey: "Accommodation", required: true,
      why: "Tenancy agreement, mortgage statement or title deeds for the UK address." },
    { folder: "05 English and tests", groupLabel: "English and TB test", title: "English language evidence", typeKey: "English-test", required: true,
      why: "An approved English test at level A1 or higher, or a degree taught in English. Not needed for some nationalities." },
    { folder: "05 English and tests", groupLabel: "English and TB test", title: "TB test certificate", typeKey: "TB-certificate", required: true,
      why: "Needed if living in Pakistan. From an approved clinic; valid for 6 months from the date of the x-ray." },
    { folder: "06 Sponsor", groupLabel: "Sponsor", title: "Sponsor's British passport or status", typeKey: "Sponsor-passport", required: true,
      why: "The photo page of the partner's British or Irish passport, or proof of settled or pre-settled status." },
  ],
};
