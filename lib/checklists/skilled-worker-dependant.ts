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
      why: "A clear photo of the photo page of the person applying.",
      howToGet: "Open the passport to the photo page. Take a photo in good light so all the text is easy to read. You can also scan it.",
      exampleImage: null, dateWindow: null },
    { folder: "01 Identity", groupLabel: "Identity", title: "Main applicant's passport and visa", typeKey: "Main-applicant-visa", required: true,
      why: "The Skilled Worker's passport photo page, and their current visa or eVisa share code — or the GWF application number if you are applying at the same time.",
      howToGet: null, exampleImage: null, dateWindow: null },
    { folder: "02 Relationship", groupLabel: "Relationship", title: "Marriage or birth certificate", typeKey: "Relationship-certificate", required: true,
      why: "The marriage or civil partnership certificate for a partner, or the full birth certificate (showing both parents) for a child.",
      howToGet: null, exampleImage: null, dateWindow: null },
    { folder: "02 Relationship", groupLabel: "Relationship", title: "Proof of living together", typeKey: "Living-together", required: false,
      why: "For unmarried partners: proof of a relationship of at least 2 years, such as letters or bills to both of you at the same address.",
      howToGet: null, exampleImage: null, dateWindow: null },
    { folder: "02 Relationship", groupLabel: "Relationship", title: "Child's proof of address", typeKey: "Child-address", required: false,
      why: "For a child: proof they live with the parent — for example a school letter. Not needed if the child is in full-time education away from home.",
      howToGet: null, exampleImage: null, dateWindow: null },
    { folder: "02 Relationship", groupLabel: "Relationship", title: "Consent from the other parent", typeKey: "Parental-consent", required: false,
      why: "For a child: needed if the other parent is not applying or is already in the UK.",
      howToGet: null, exampleImage: null, dateWindow: null },
    { folder: "03 Finances", groupLabel: "Finances", title: "Bank statements", typeKey: "Bank-statement", required: false,
      why: "You need £285 for a partner, £315 for one child, or £200 for each extra child, held for 28 days in a row. Not needed if the employer has confirmed this on the CoS.",
      howToGet: "Download from your banking app. Go to Statements and save or export as PDF. You need to show the balance for each of the 28 days.",
      exampleImage: null, dateWindow: "last 28 days" },
    { folder: "04 Health", groupLabel: "Health", title: "TB test certificate", typeKey: "TB-certificate", required: true,
      why: "Only needed if you live in Pakistan. It must be from an approved clinic and is valid for 6 months from the date of the x-ray.",
      howToGet: "Book an appointment at a UK Visas and Immigration approved clinic. Search gov.uk/tb-test-visa for a list near you.",
      exampleImage: null, dateWindow: "last 6 months" },
  ],
};
