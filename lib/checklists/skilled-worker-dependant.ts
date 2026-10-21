/**
 * Skilled Worker dependant (partner or child). Checked against GOV.UK on 19 Oct 2026:
 * gov.uk/skilled-worker-visa/your-partner-and-children, gov.uk/tb-test-visa.
 */
export const skilledWorkerDependant = {
  name: "Skilled Worker dependant (partner or child)",
  extraFolders: ["06 Translations", "07 Correspondence"],
  retiredKeys: [] as string[],
  items: [
    { folder: "01 Identity", groupLabel: "Identity", title: "Passport", typeKey: "Passport", required: true,
      why: "A clear photo of the personal details page of the person applying." },
    { folder: "01 Identity", groupLabel: "Identity", title: "Main applicant's passport and visa", typeKey: "Main-applicant-visa", required: true,
      why: "The Skilled Worker's passport photo page, and their visa or eVisa share code, or GWF application number if applying together." },
    { folder: "02 Relationship", groupLabel: "Relationship", title: "Marriage or birth certificate", typeKey: "Relationship-certificate", required: true,
      why: "Marriage or civil partnership certificate for a partner; full birth certificate showing both parents for a child." },
    { folder: "02 Relationship", groupLabel: "Relationship", title: "Evidence of living together", typeKey: "Living-together", required: false,
      why: "For unmarried partners: proof of a relationship of at least 2 years, such as letters or bills to both at the same address." },
    { folder: "02 Relationship", groupLabel: "Relationship", title: "Child's proof of address", typeKey: "Child-address", required: false,
      why: "For a child: proof they live with the parent, such as a school letter, unless in full-time education away from home." },
    { folder: "02 Relationship", groupLabel: "Relationship", title: "Consent from the other parent", typeKey: "Parental-consent", required: false,
      why: "For a child, if one parent is not applying or already in the UK." },
    { folder: "03 Finances", groupLabel: "Finances", title: "Bank statements", typeKey: "Bank-statement", required: false,
      why: "£285 for a partner, £315 for one child, £200 for each other child, held 28 days in a row. Not needed if the employer certifies maintenance." },
    { folder: "04 Health", groupLabel: "Health", title: "TB test certificate", typeKey: "TB-certificate", required: true,
      why: "Needed if living in Pakistan. From an approved clinic; valid for 6 months from the date of the x-ray." },
  ],
};
