// Question sets for the onboarding Q/A (customer-facing, signed at the same
// time as the agreement) and the installation QA checklist (crew-facing).
//
// Both are plain data so Mady can add or reword a question without touching a
// component. Ids are stored in the HubSpot record and must stay stable — change
// an id and past submissions stop lining up with their question.

export type Field = {
  id: string;
  label: string;
  type: "text" | "textarea" | "select" | "check";
  options?: string[];
  required?: boolean;
  help?: string;
};

export type FieldGroup = { title: string; blurb?: string; fields: Field[] };

// Everything the crew currently asks on paper at the kitchen table.
export const ONBOARDING: FieldGroup[] = [
  {
    title: "The property",
    fields: [
      { id: "property_address", label: "Property address", type: "text", required: true },
      { id: "property_type", label: "Property type", type: "select", options: ["Single-family home", "Townhouse or villa", "Condo", "Commercial premises", "Other"], required: true },
      { id: "year_built", label: "Roughly when was it built?", type: "text" },
      { id: "prior_flooding", label: "Has the property taken on water before?", type: "textarea", help: "Which storm, how deep, and which openings let water in." },
    ],
  },
  {
    title: "The openings we're protecting",
    fields: [
      { id: "openings", label: "Which openings are in scope?", type: "textarea", required: true, help: "For example: front door, garage, two sliders on the lanai." },
      { id: "surface", label: "What's the ground surface at each opening?", type: "select", options: ["Concrete", "Pavers", "Brick", "Tile", "Mixed", "Not sure"], required: true },
      { id: "surface_level", label: "Is the ground level and even at each opening?", type: "select", options: ["Level", "Slight slope or dip", "Noticeably uneven", "Not sure"], help: "The bottom plank seals against the ground, so uneven surfaces may need levelling." },
      { id: "obstructions", label: "Anything in the way?", type: "textarea", help: "Railings, downpipes, planters, screen tracks, irrigation." },
    ],
  },
  {
    title: "Installation day",
    fields: [
      { id: "access_notes", label: "How does the crew get in?", type: "textarea", help: "Gate codes, HOA check-in, parking, where to unload." },
      { id: "hoa_approval", label: "Does an HOA or condo board need to approve this?", type: "select", options: ["No", "Yes, already approved", "Yes, still pending", "Not sure"] },
      { id: "pets", label: "Pets or anything the crew should know about on site?", type: "text" },
      { id: "preferred_window", label: "Preferred installation window", type: "text", help: "Days of the week or times that suit you." },
    ],
  },
  {
    title: "Living with the system",
    fields: [
      { id: "deployer", label: "Who will put the planks up when a storm is coming?", type: "select", options: ["I will", "A family member", "A property manager or caretaker", "A neighbour", "Not decided yet"], required: true, help: "The barrier is deployed manually, so somebody needs to be able to do it and be nearby." },
      { id: "deployer_contact", label: "If that isn't you, who is it and how do we reach them?", type: "text" },
      { id: "storage", label: "Where will the planks be stored between storms?", type: "text", help: "They store flat. Garage, shed and under-stair cupboards all work." },
      { id: "mobility", label: "Any lifting or mobility limits we should design around?", type: "textarea" },
    ],
  },
  {
    title: "Anything else",
    fields: [
      { id: "questions", label: "What questions do you still have for us?", type: "textarea" },
      { id: "heard_about", label: "How did you hear about HydroDam?", type: "select", options: ["Google", "A neighbour or friend", "Saw an installation nearby", "Social media", "Home show or event", "Other"] },
    ],
  },
];

// Signed off by the installer on site, one per job.
export const QA_CHECKLIST: FieldGroup[] = [
  {
    title: "Before leaving the shop",
    fields: [
      { id: "parts_match_order", label: "Plank count and lengths match the signed order", type: "check", required: true },
      { id: "seals_intact", label: "EPDM seals present and undamaged on every plank", type: "check", required: true },
      { id: "hardware_complete", label: "Posts, expansion bolts, locking plate and Allen wrench all packed", type: "check", required: true },
      { id: "finish_ok", label: "Finish inspected, no shipping damage or scratches", type: "check", required: true },
    ],
  },
  {
    title: "Site preparation",
    fields: [
      { id: "opening_measured", label: "Opening re-measured on site against the order", type: "check", required: true },
      { id: "measured_width", label: "Measured width (in)", type: "text", required: true },
      { id: "measured_height", label: "Measured protection height (in)", type: "text", required: true },
      { id: "centre_post", label: "Centre post fitted where the opening exceeds 9 ft", type: "select", options: ["Not required", "Required and fitted", "Required, NOT fitted"], required: true, help: "A middle post is required on any opening wider than 9 ft." },
      { id: "surface_prepared", label: "Ground surface level and clean where the bottom plank seals", type: "check", required: true },
      { id: "utilities_checked", label: "Checked for buried services before drilling", type: "check", required: true },
    ],
  },
  {
    title: "Installation",
    fields: [
      { id: "posts_plumb", label: "Support posts plumb and square to the opening", type: "check", required: true },
      { id: "anchors_torqued", label: "Expansion bolts set and torqued", type: "check", required: true },
      { id: "planks_seat", label: "Every plank seats fully and locks without forcing", type: "check", required: true },
      { id: "locking_plate", label: "Top locking plate fitted and tightened", type: "check", required: true },
      { id: "seal_contact", label: "Bottom seal makes continuous contact along the full width", type: "check", required: true },
      { id: "debris_cleared", label: "Drill spoil and packaging removed from site", type: "check", required: true },
    ],
  },
  {
    title: "Handover to the customer",
    fields: [
      { id: "demo_given", label: "Deployment demonstrated to the customer end to end", type: "check", required: true },
      { id: "customer_deployed", label: "Customer put up and took down at least one plank themselves", type: "check", required: true, help: "This is the one that prevents a panicked phone call the night before a storm." },
      { id: "storage_agreed", label: "Storage location agreed and planks left there", type: "check", required: true },
      { id: "docs_left", label: "Installation and maintenance guides handed over", type: "check", required: true },
      { id: "thirty_day_explained", label: "30-day functionality check explained, in writing, to the customer", type: "check", required: true },
      { id: "photos_taken", label: "Photos taken of the finished installation", type: "check", required: true },
    ],
  },
  {
    title: "Sign-off",
    fields: [
      { id: "issues", label: "Anything outstanding, damaged or to come back for?", type: "textarea", help: "Write “none” if the job is complete." },
      { id: "installer", label: "Installer name", type: "text", required: true },
    ],
  },
];

export const allFields = (groups: FieldGroup[]): Field[] => groups.flatMap((g) => g.fields);
