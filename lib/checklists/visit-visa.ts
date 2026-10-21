/**
 * Standard Visitor visa. Checked against GOV.UK on 19 Oct 2026: gov.uk/standard-visitor/apply-standard-visitor-visa
 * and "Visiting the UK: guide to supporting documents" (which says hotel and flight bookings are not useful evidence).
 */
export const visitVisa = {
  name: "Visit visa",
  extraFolders: ["07 Translations", "08 Correspondence"],
  retiredKeys: ["Travel-plans"],
  items: [
    { folder: "01 Identity", groupLabel: "Identity", title: "Passport", typeKey: "Passport", required: true,
      why: "A clear photo of the personal details page. It must be valid for the whole visit." },
    { folder: "01 Identity", groupLabel: "Identity", title: "Previous passports", typeKey: "Previous-passport", required: false,
      why: "Earlier passports showing travel to other countries in the last 10 years." },
    { folder: "01 Identity", groupLabel: "Identity", title: "Family registration certificate", typeKey: "Family-registration", required: false,
      why: "If visiting family: the NADRA family registration certificate (FRC) showing the relationship." },
    { folder: "02 Purpose of visit", groupLabel: "Purpose of visit", title: "Invitation letter", typeKey: "Invitation-letter", required: false,
      why: "If visiting family or friends, or attending an event: a letter from the host or organiser with the address and dates." },
    { folder: "03 Finances", groupLabel: "Finances", title: "Bank statements", typeKey: "Bank-statement", required: true,
      why: "Recent statements showing enough money for the trip and where it came from. Statements over a year old are not useful." },
    { folder: "03 Finances", groupLabel: "Finances", title: "Proof of income", typeKey: "Income", required: true,
      why: "Recent payslips, or business and tax records if self-employed." },
    { folder: "03 Finances", groupLabel: "Finances", title: "Property or other assets", typeKey: "Assets", required: false,
      why: "Property documents or savings certificates, if available." },
    { folder: "04 Ties to home", groupLabel: "Ties to home", title: "Employer's letter", typeKey: "Employer-letter", required: false,
      why: "If employed: on headed paper, with role, salary, length of employment and approved leave." },
    { folder: "04 Ties to home", groupLabel: "Ties to home", title: "Business registration", typeKey: "Business-registration", required: false,
      why: "If self-employed: business registration and tax returns." },
    { folder: "04 Ties to home", groupLabel: "Ties to home", title: "Letter from school or university", typeKey: "Study-letter", required: false,
      why: "If studying: on headed paper, confirming enrolment and leave of absence." },
    { folder: "05 Sponsor", groupLabel: "Sponsor", title: "Sponsor's letter and ID", typeKey: "Sponsor-letter", required: false,
      why: "Only if someone else is paying: what they will provide, their relationship to the applicant, and their passport or ID." },
    { folder: "05 Sponsor", groupLabel: "Sponsor", title: "Sponsor's bank statements", typeKey: "Sponsor-bank-statement", required: false,
      why: "Only if someone else is paying: recent statements showing they can afford it." },
    { folder: "06 Immigration history", groupLabel: "Immigration history", title: "Previous visa refusals", typeKey: "Previous-refusal", required: false,
      why: "Any earlier refusal letters from any country. Upload them even if they seem minor." },
    { folder: "06 Immigration history", groupLabel: "Immigration history", title: "TB test certificate", typeKey: "TB-certificate", required: false,
      why: "Only for visits of more than 6 months by someone living in Pakistan." },
  ],
};
