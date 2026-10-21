/**
 * Skilled Worker visa (from outside the UK). Checked against GOV.UK on 19 Oct 2026:
 * gov.uk/skilled-worker-visa/documents-you-must-provide, /knowledge-of-english, /how-much-it-costs, gov.uk/tb-test-visa.
 */
export const skilledWorker = {
  name: "Skilled Worker visa",
  extraFolders: ["07 Translations", "08 Correspondence"],
  retiredKeys: ["Job-offer", "Degree"],
  items: [
    { folder: "01 Identity", groupLabel: "Identity", title: "Passport", typeKey: "Passport", required: true,
      why: "A clear photo of the personal details page." },
    { folder: "01 Identity", groupLabel: "Identity", title: "Previous passports and UK visas", typeKey: "Previous-passport", required: false,
      why: "Earlier passports, UK visas or residence permits, if available." },
    { folder: "02 Job and sponsor", groupLabel: "Job and sponsor", title: "Certificate of Sponsorship details", typeKey: "CoS", required: true,
      why: "From the employer: the CoS reference number, job title, annual salary, occupation code and sponsor licence number." },
    { folder: "02 Job and sponsor", groupLabel: "Job and sponsor", title: "Employment contract or offer letter", typeKey: "Contract", required: false,
      why: "Helps the caseworker check the job details match the Certificate of Sponsorship." },
    { folder: "03 English and qualifications", groupLabel: "English and qualifications", title: "English language evidence", typeKey: "English", required: true,
      why: "Level B2: an approved English test, a UK degree, or an Ecctis reference for a degree taught in English. Not needed for some nationalities." },
    { folder: "03 English and qualifications", groupLabel: "English and qualifications", title: "PhD certificate or Ecctis reference", typeKey: "PhD", required: false,
      why: "Only if a PhD relevant to the job is used for the salary rules." },
    { folder: "03 English and qualifications", groupLabel: "English and qualifications", title: "ATAS certificate", typeKey: "ATAS", required: false,
      why: "Only if the employer says one is needed for research in a sensitive subject at PhD level or above." },
    { folder: "04 Finances", groupLabel: "Finances", title: "Bank statements", typeKey: "Bank-statement", required: false,
      why: "At least £1,270 held for 28 days in a row, with day 28 within 31 days of applying. Not needed if the employer certifies maintenance on the CoS." },
    { folder: "05 Health and character", groupLabel: "Health and character", title: "TB test certificate", typeKey: "TB-certificate", required: true,
      why: "Needed if living in Pakistan. From an approved clinic; valid for 6 months from the date of the x-ray." },
    { folder: "05 Health and character", groupLabel: "Health and character", title: "Criminal record certificate", typeKey: "Police-certificate", required: false,
      why: "Only for jobs in education, healthcare, therapy or social services: one from each country lived in for 12 months or more (last 10 years if 28 or over)." },
  ],
};
