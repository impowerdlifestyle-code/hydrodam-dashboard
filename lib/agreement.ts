// The 5-Year Limited Warranty and Purchase Agreement, transcribed verbatim from
// "Hydro Dam 5 Yr Warranty and Purchase Agreement.pdf" (Madeline Scribner,
// 2026-07-28). The text is rendered inside the signing flow rather than linked
// as a download, so the signing record can state exactly what the customer had
// in front of them.
//
// AGREEMENT_VERSION is stored on every signature. Bump it whenever a word of
// this changes, otherwise old records will claim terms nobody ever agreed to.

export const AGREEMENT_VERSION = "2026-07-28";

export type Clause = { heading: string; body: string[] };

export const WARRANTY: Clause[] = [
  {
    heading: "1. What this warranty covers",
    body: [
      "Hydro Dam, LLC (“Hydro Dam”) provides this limited warranty to the original purchaser of the product. Hydro Dam guarantees that the product sold: (a) meets Hydro Dam’s published specifications, and (b) is free from defects in materials, workmanship, and installation when the installation is performed by Hydro Dam.",
      "This warranty is valid for five (5) years from the date the product is delivered and installed.",
      "If, during that period, the purchaser discovers that the product does not meet specifications or has a defect in materials, workmanship, or installation, written notice must be given to Hydro Dam no later than 30 days after the warranty period ends. The notice should include details of the issue, the conditions under which it occurred, and, if applicable, a sample showing the defect so that Hydro Dam can evaluate it.",
      "If the product is found to be defective under these terms, Hydro Dam will, at its expense, replace the defective items once they have been returned (shipping prepaid) to our facility in St. Petersburg, Florida. Because each custom order is built to specification, those items are non returnable. All sales of custom barriers or components, including Hydro Dam aluminum planks, are final.",
    ],
  },
  {
    heading: "2. What this warranty does not cover",
    body: [
      "This warranty does not apply in the following situations: products not manufactured by Hydro Dam; damage resulting from improper installation conditions; use of the product in ways other than intended; damage caused by disasters such as fire, flood conditions beyond design limits, or loading beyond design specifications; damage from unauthorized attachments or modifications; damage occurring during shipping, storage, mishandling, or abuse; damage due to failure to deploy barriers before a flood event; damage caused by water overtopping the barrier height; damage resulting from deployment errors by someone other than Hydro Dam’s installation team; damage caused by user error during deployment or removal.",
      "Hydro Dam products are carefully manufactured and inspected before leaving our facility. Damage that happens during customer handling or deployment can be avoided by following installation and usage instructions closely. Custom products are non returnable. All sales of custom barriers or parts, including Hydro Dam aluminum planks, are final.",
    ],
  },
  {
    heading: "3. Warranty of title",
    body: [
      "Hydro Dam also warrants that it holds clear title to the products it sells and that they will be shipped directly from Hydro Dam’s facility free of liens or encumbrances.",
    ],
  },
  {
    heading: "4. Other warranties disclaimed",
    body: [
      "The warranties stated above replace any other express or implied warranties, including implied warranties of merchantability or fitness for a particular purpose.",
    ],
  },
  {
    heading: "5. Limitation of remedies",
    body: [
      "Hydro Dam will not be responsible for any special, incidental, or consequential damages. This includes, but is not limited to, lost profits, lost revenue or savings, loss of use of the product or related equipment, cost of replacement equipment or services, downtime, third party claims, or property damage. This limitation does not apply to claims for personal injury or breach of warranty of title. Some states do not allow certain warranty or remedy limitations, so these restrictions may not apply in all situations.",
    ],
  },
  {
    heading: "6. Time limit for claims",
    body: [
      "Any claim for breach of this warranty must be filed within five (5) years and thirty (30) days from the date the product was delivered.",
    ],
  },
  {
    heading: "7. Complete agreement",
    body: [
      "Unless modified in a written agreement signed by both parties, this warranty is the full and exclusive agreement between Hydro Dam and the purchaser. It replaces any previous oral or written agreements or promises regarding the product. No employee or representative of Hydro Dam is authorized to offer any additional warranty beyond what is stated here.",
    ],
  },
  {
    heading: "8. Risk allocation",
    body: [
      "This warranty represents how Hydro Dam and the purchaser agree to share the risks of product failure. That agreement is reflected in the price of the product. By purchasing, the buyer acknowledges that they have read, understood, and accepted these terms.",
    ],
  },
];

export const TERMS_OF_SALE: Clause[] = [
  {
    heading: "1. Final Sale",
    body: [
      "All sales of Hydro Dam flood mitigation systems are final. Once installation is complete, no refunds, returns, or exchanges will be permitted.",
    ],
  },
  {
    heading: "2. Customer Responsibility for Deployment",
    body: [
      "The Hydro Dam system requires proactive, manual placement of planks or panels by the customer or their representative when flooding is imminent. Hydro Dam assumes no responsibility for, and shall not be held liable for, the accuracy, timeliness, or completeness of such actions. Please refer to the Installation Guide when setting up the flood barrier.",
    ],
  },
  {
    heading: "3. No Guarantee of Flood Protection",
    body: [
      "While Hydro Dam’s systems are designed to withstand significant water pressure, storm surge, and debris, no guarantee of complete flood protection is made or implied. Hydro Dam shall not be liable for water intrusion, property damage, or losses that may occur due to environmental conditions, weather severity, improper use, or any other cause.",
    ],
  },
  {
    heading: "4. Limited Liability",
    body: [
      "Hydro Dam’s responsibility ends upon completion of installation. After installation, Hydro Dam bears no liability for damages, losses, or claims of any kind, whether direct, indirect, incidental, or consequential.",
    ],
  },
  {
    heading: "5. 30-Day Functionality Check",
    body: [
      "The customer has thirty (30) calendar days from the date of installation to conduct a functionality check of the installed system. See Operational and Maintenance Guide. Any issues, defects, or concerns must be reported in writing.",
      "Reports must be mailed to: Hydro Dam, LLC, 6140 Ulmerton Road, Clearwater, Florida 33760. Reports must include the customer’s name, property address, date of installation, and a description of the issue(s). Reports must be postmarked within the thirty (30) day period.",
    ],
  },
  {
    heading: "6. Indemnification",
    body: [
      "By signing this agreement, the customer releases and discharges Hydro Dam, its officers, employees, contractors, and representatives from all claims, liabilities, or damages related to the Products after installation. The customer agrees to indemnify and hold Hydro Dam harmless from any claims by third parties arising from use or non-use of the system.",
    ],
  },
];

export const ACKNOWLEDGMENT =
  "By signing below, I acknowledge that I have reviewed and approved the Project Plan, Warranty, and Purchase Agreement provided by Hydro Dam, LLC. I understand and accept the terms outlined in these documents and authorize Hydro Dam, LLC to proceed accordingly.";

export const ESIGN_CONSENT =
  "I agree to do business electronically with Hydro Dam, LLC, and I understand that typing my name below constitutes my legal signature on this agreement, with the same effect as signing on paper.";
