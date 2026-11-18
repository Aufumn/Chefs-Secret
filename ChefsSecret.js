console.log("Chefs Secret JS connected");

let recipes = [];
let currentUser = null;

const ALLERGEN_LIST = ["Milk", "Eggs", "Peanuts", "TreeNuts", "Wheat", "Fish", "Shellfish", "Soy", "Sesame"];
const DIET_CHECKBOXES = ["Vegetarian", "Vegan", "Pescatarian", "LowCarb"];

const DIET_TYPE_MATCH = {
  Vegetarian: ["Vegetarian", "Vegan"],
  Vegan: ["Vegan"],
  Pescatarian: ["Pescatarian", "Vegetarian", "Vegan"]
};

// How much an activity level nudges the calorie-based goal thresholds (per meal).
// This is a rough heuristic, not a clinical calculation.
const ACTIVITY_CALORIE_OFFSET = {
  Sedentary: -50,
  "Lightly Active": 0,
  "Moderately Active": 50,
  "Very Active": 100
};

const PROFILES_KEY = "chefdSecretProfiles";
const CURRENT_USER_KEY = "chefdSecretCurrentUser";
const STATS_KEY = "chefdSecretRecipeStats"; // shared like/dislike counts, local to this browser
const DISCLAIMER_KEY = "chefsSecretDisclaimerAccepted";

const PAGE_SIZE = 6;
let fullResults = [];      // everything that matched the last search, in display order
let visibleCount = 0;      // how many of fullResults are currently shown
let lastGoal = "No Preference";

/* ===========================
   PROFILE / LOGIN MANAGEMENT
=========================== */

function getProfiles() {
  try {
    return JSON.parse(localStorage.getItem(PROFILES_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function saveProfiles(profiles) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

function getProfile(username) {
  const profiles = getProfiles();
  if (!profiles[username]) {
    profiles[username] = { likes: [], dislikes: [], saved: [] };
    saveProfiles(profiles);
  }
  return profiles[username];
}

function updateProfile(username, updaterFn) {
  const profiles = getProfiles();
  const profile = profiles[username] || { likes: [], dislikes: [], saved: [] };
  updaterFn(profile);
  profiles[username] = profile;
  saveProfiles(profiles);
}

function login(username) {
  username = username.trim();
  if (!username) {
    alert("Please enter a username.");
    return;
  }
  getProfile(username); // ensures profile exists
  currentUser = username;
  localStorage.setItem(CURRENT_USER_KEY, username);
  showApp();
}

function logout() {
  currentUser = null;
  localStorage.removeItem(CURRENT_USER_KEY);
  document.getElementById("appSection").style.display = "none";
  document.getElementById("authSection").style.display = "block";
  document.getElementById("usernameInput").value = "";
}

function showApp() {
  document.getElementById("authSection").style.display = "none";
  document.getElementById("appSection").style.display = "block";
  document.getElementById("userLabel").textContent = `Logged in as ${currentUser}`;
}

/* ===========================
   RECIPE RATING STATS (shared like/dislike counts)
=========================== */

function getStats() {
  try {
    return JSON.parse(localStorage.getItem(STATS_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function saveStats(stats) {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

function getRecipeStats(recipeName) {
  const stats = getStats();
  return stats[recipeName] || { likes: 0, dislikes: 0 };
}

function adjustStat(recipeName, field, delta) {
  const stats = getStats();
  if (!stats[recipeName]) stats[recipeName] = { likes: 0, dislikes: 0 };
  stats[recipeName][field] = Math.max(0, stats[recipeName][field] + delta);
  saveStats(stats);
  return stats[recipeName];
}

/* ===========================
   FIRST-OPEN DISCLAIMER
=========================== */

function disclaimerAccepted() {
  try {
    return localStorage.getItem(DISCLAIMER_KEY) === "yes";
  } catch (e) {
    return false;
  }
}

function showDisclaimer() {
  document.getElementById("disclaimerOverlay").style.display = "flex";
  document.getElementById("acceptDisclaimerBtn").focus();
}

function acceptDisclaimer() {
  try {
    localStorage.setItem(DISCLAIMER_KEY, "yes");
  } catch (e) {
    // storage unavailable: the notice will simply show again next visit
  }
  document.getElementById("disclaimerOverlay").style.display = "none";
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ===========================
   RECIPE / CSV LOADING
=========================== */

document.addEventListener("DOMContentLoaded", () => {
  loadCSV();

  document.getElementById("loginBtn").addEventListener("click", () => {
    login(document.getElementById("usernameInput").value);
  });

  document.getElementById("usernameInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") login(document.getElementById("usernameInput").value);
  });

  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("findBtn").addEventListener("click", findRecipes);
  document.getElementById("viewSavedBtn").addEventListener("click", showSavedRecipes);
  document.getElementById("showMoreBtn").addEventListener("click", showMoreResults);

  document.getElementById("acceptDisclaimerBtn").addEventListener("click", acceptDisclaimer);
  document.getElementById("showDisclaimerLink").addEventListener("click", (e) => {
    e.preventDefault();
    showDisclaimer();
  });
  if (!disclaimerAccepted()) showDisclaimer();

  // Lifestyle quiz: answering "what are you hoping to do" auto-selects a Goal radio
  document.querySelectorAll('input[name="weightDirection"]').forEach(radio => {
    radio.addEventListener("change", (e) => {
      const value = e.target.value;
      if (value === "skip") return;
      const goalRadio = document.querySelector(`input[name="goal"][value="${value}"]`);
      if (goalRadio) goalRadio.checked = true;
    });
  });

  const rememberedUser = localStorage.getItem(CURRENT_USER_KEY);
  if (rememberedUser) {
    currentUser = rememberedUser;
    showApp();
  }
});

async function loadCSV() {
  try {
    console.log("Starting CSV load...");

    const response = await fetch("./ChefsSecret.csv");

    if (!response.ok) {
      throw new Error(
        `CSV failed to load: ${response.status} ${response.statusText}`
      );
    }

    const text = await response.text();

    console.log("CSV loaded successfully.");
    console.log("CSV length:", text.length);

    const rows = text.trim().split(/\r?\n/);

    if (rows.length < 2) {
      throw new Error("CSV file is empty or has no recipe rows.");
    }

    const headers = parseCSVRow(rows[0]);

    recipes = [];

    for (let i = 1; i < rows.length; i++) {
      if (!rows[i].trim()) continue;

      const values = parseCSVRow(rows[i]);
      let recipe = {};

      headers.forEach((header, index) => {
        recipe[header.trim()] =
          values[index]?.trim().replace(/\r/g, "") || "";
      });

      recipes.push(recipe);
    }

    console.log("Recipes loaded:", recipes.length);
    populateBrowseFilters();

  } catch (error) {
    console.error("ERROR LOADING RECIPES:", error);
    alert("There was a problem loading the recipes. Check the browser console.");
  }
}

function populateBrowseFilters() {
  const fill = (selectId, column) => {
    const select = document.getElementById(selectId);
    const values = [...new Set(recipes.map(r => r[column]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    values.forEach(value => {
      const count = recipes.filter(r => r[column] === value).length;
      const option = document.createElement("option");
      option.value = value;
      option.textContent = `${value} (${count})`;
      select.appendChild(option);
    });
  };
  fill("proteinSelect", "Protein");
  fill("cuisineSelect", "Cuisine");
  fill("dishTypeSelect", "DishType");
}

function parseCSVRow(row) {
  const result = [];
  let current = "";
  let insideQuotes = false;

  for (let char of row) {
    if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === "," && !insideQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

/* ===========================
   FILTERING LOGIC
=========================== */

function isAllergySafe(recipe, allergies) {
  for (let allergy in allergies) {
    if (allergies[allergy] && recipe[allergy]?.trim().toUpperCase() !== "N") {
      return false;
    }
  }
  return true;
}

function matchesGoal(recipe, goal, activityLevel) {
  if (goal === "No Preference") return true;

  const calories = parseFloat(recipe.Calories);
  const protein = parseFloat(recipe.Protein_g);
  const carbs = parseFloat(recipe.Carbs_g);
  const offset = ACTIVITY_CALORIE_OFFSET[activityLevel] || 0;

  switch (goal) {
    case "Weight Loss":
      return calories <= 450 + offset;
    case "Muscle Gain":
      return protein >= 28;
    case "Endurance":
      return carbs >= 45;
    case "Maintenance":
      return calories >= 300 + offset * 0.5 && calories <= 650 + offset;
    default:
      return true;
  }
}

function matchesDietPrefs(recipe, selectedDiets) {
  return selectedDiets.every(diet => {
    if (diet === "LowCarb") {
      return parseFloat(recipe.Carbs_g) <= 30;
    }
    const allowedTypes = DIET_TYPE_MATCH[diet];
    return allowedTypes ? allowedTypes.includes(recipe.DietType) : true;
  });
}

function matchesBrowse(recipe, protein, cuisine, dishType) {
  if (protein && recipe.Protein !== protein) return false;
  if (cuisine && recipe.Cuisine !== cuisine) return false;
  if (dishType && recipe.DishType !== dishType) return false;
  return true;
}

/* ===========================
   MAIN SEARCH
=========================== */

function findRecipes() {
  if (recipes.length === 0) {
    alert("Recipes are still loading. Please wait.");
    return;
  }
  document.getElementById("savedResults").innerHTML = "";

  const allergies = {};
  ALLERGEN_LIST.forEach(allergen => {
    allergies[allergen] = document.getElementById(allergen).checked;
  });

  const goal = document.querySelector('input[name="goal"]:checked').value;
  const stepsValue = document.querySelector('input[name="steps"]:checked').value;
  const activityLevel = stepsValue === "skip" ? null : stepsValue;

  const selectedDiets = DIET_CHECKBOXES.filter(
    id => document.getElementById(id)?.checked
  );

  const proteinChoice = document.getElementById("proteinSelect").value;
  const cuisineChoice = document.getElementById("cuisineSelect").value;
  const dishTypeChoice = document.getElementById("dishTypeSelect").value;

  const allergySafe = recipes.filter(r => isAllergySafe(r, allergies));
  const lifestyleMatch = recipes.filter(
    r => matchesGoal(r, goal, activityLevel) &&
         matchesDietPrefs(r, selectedDiets) &&
         matchesBrowse(r, proteinChoice, cuisineChoice, dishTypeChoice)
  );

  const allergySafeNames = new Set(allergySafe.map(r => r.Recipe));
  const lifestyleMatchNames = new Set(lifestyleMatch.map(r => r.Recipe));

  let overlap = recipes.filter(
    r => allergySafeNames.has(r.Recipe) && lifestyleMatchNames.has(r.Recipe)
  );

  const leftOnlyCount = allergySafe.length - overlap.length;
  const rightOnlyCount = lifestyleMatch.length - overlap.length;
  const overlapCount = overlap.length;

  drawVenn(leftOnlyCount, overlapCount, rightOnlyCount);

  // Hide anything the user has disliked, and float liked recipes to the top
  const profile = getProfile(currentUser);
  overlap = overlap.filter(r => !profile.dislikes.includes(r.Recipe));
  shuffle(overlap); // fresh variety each search; the sort below is stable
  overlap.sort((a, b) => {
    const aLiked = profile.likes.includes(a.Recipe) ? 1 : 0;
    const bLiked = profile.likes.includes(b.Recipe) ? 1 : 0;
    return bLiked - aLiked;
  });

  fullResults = overlap;
  visibleCount = PAGE_SIZE;
  lastGoal = goal;
  renderPage();
}

function renderPage() {
  const shown = fullResults.slice(0, visibleCount);
  renderResults(shown, lastGoal, "results", "No recipes match both your allergy and lifestyle selections.");

  const countEl = document.getElementById("resultCount");
  const moreBtn = document.getElementById("showMoreBtn");
  if (fullResults.length === 0) {
    countEl.textContent = "";
    moreBtn.style.display = "none";
    return;
  }
  countEl.textContent = `Showing ${shown.length} of ${fullResults.length} matching recipes`;
  moreBtn.style.display = visibleCount < fullResults.length ? "block" : "none";
}

function showMoreResults() {
  visibleCount += PAGE_SIZE;
  renderPage();
}

function drawVenn(leftOnly, overlap, rightOnly) {
  const vennWrap = document.getElementById("vennWrap");

  const svg = `
    <svg viewBox="0 0 340 230" xmlns="http://www.w3.org/2000/svg">
      <circle cx="140" cy="110" r="90" fill="var(--accent)" opacity="0.45"></circle>
      <circle cx="220" cy="110" r="90" fill="var(--accent2)" opacity="0.45"></circle>

      <text x="90" y="35" text-anchor="middle" font-size="13" font-weight="600" fill="var(--text)">Allergen-Safe</text>
      <text x="270" y="35" text-anchor="middle" font-size="13" font-weight="600" fill="var(--text)">Lifestyle Match</text>

      <text x="105" y="115" text-anchor="middle" font-size="26" font-weight="600" fill="var(--text)">${leftOnly}</text>
      <text x="180" y="115" text-anchor="middle" font-size="26" font-weight="600" fill="var(--text)">${overlap}</text>
      <text x="255" y="115" text-anchor="middle" font-size="26" font-weight="600" fill="var(--text)">${rightOnly}</text>

      <text x="180" y="205" text-anchor="middle" font-size="12" fill="var(--text)">Recommended</text>
    </svg>
    <div class="venn-caption">${leftOnly} allergen-safe only &middot; ${overlap} match both &middot; ${rightOnly} lifestyle-match only</div>
  `;

  vennWrap.innerHTML = svg;
}

/* ===========================
   SAVED RECIPES VIEW
=========================== */

function showSavedRecipes() {
  document.getElementById("results").innerHTML = "";
  document.getElementById("vennWrap").innerHTML = "";
  document.getElementById("resultCount").textContent = "";
  document.getElementById("showMoreBtn").style.display = "none";
  fullResults = [];

  const profile = getProfile(currentUser);
  const savedRecipes = recipes.filter(r => profile.saved.includes(r.Recipe));

  renderResults(savedRecipes, null, "savedResults", "You haven't saved any recipes yet — hit \"Save\" on a recipe card to add it here.");
}

/* ===========================
   RENDERING + LIKE/DISLIKE/SAVE
=========================== */

function renderResults(list, goal, targetId, emptyMessage) {
  const resultsDiv = document.getElementById(targetId);
  resultsDiv.innerHTML = "";

  if (list.length === 0) {
    resultsDiv.innerHTML = `<p>${emptyMessage}</p>`;
    return;
  }

  const profile = getProfile(currentUser);

  list.forEach(recipe => {
    const card = document.createElement("div");
    card.classList.add("recipe-card");

    const title = document.createElement("h3");
    title.textContent = recipe.Recipe;

    const tagContainer = document.createElement("div");
    tagContainer.classList.add("recipe-tags");

    let hasAllergens = false;
    ALLERGEN_LIST.forEach(allergen => {
      if (recipe[allergen]?.trim().toUpperCase() === "Y") {
        hasAllergens = true;
        const tag = document.createElement("span");
        tag.classList.add("tag");
        tag.textContent = allergen === "TreeNuts" ? "Tree Nuts" : allergen;
        tagContainer.appendChild(tag);
      }
    });
    if (!hasAllergens) {
      const safeTag = document.createElement("span");
      safeTag.classList.add("tag");
      safeTag.textContent = "No Allergens";
      tagContainer.appendChild(safeTag);
    }

    if (goal) {
      const lifestyleTag = document.createElement("span");
      lifestyleTag.classList.add("tag", "lifestyle");
      lifestyleTag.textContent = goal === "No Preference" ? recipe.DietType : `${recipe.DietType} · ${goal} fit`;
      tagContainer.appendChild(lifestyleTag);
    }

    const styleTag = document.createElement("span");
    styleTag.classList.add("tag", "lifestyle");
    styleTag.textContent = `${recipe.Cuisine} · ${recipe.DishType}`;
    tagContainer.appendChild(styleTag);

    const macros = document.createElement("p");
    macros.innerHTML = `<strong>Per Serving (${recipe.ServingSize}):</strong> ${recipe.Calories} kcal · ${recipe.Protein_g}g protein · ${recipe.Carbs_g}g carbs · ${recipe.Fats_g}g fat`;

    const ingredients = document.createElement("p");
    ingredients.innerHTML = `<strong>Ingredients:</strong> ${recipe.Ingredients}`;

    const instructions = document.createElement("p");
    instructions.innerHTML = `<strong>Instructions:</strong> ${recipe.Instructions}`;

    const actionRow = document.createElement("div");
    actionRow.classList.add("action-row");

    const likeBtn = document.createElement("button");
    likeBtn.classList.add("action-btn", "like");
    likeBtn.textContent = "👍 Like";
    if (profile.likes.includes(recipe.Recipe)) likeBtn.classList.add("active");

    const dislikeBtn = document.createElement("button");
    dislikeBtn.classList.add("action-btn", "dislike");
    dislikeBtn.textContent = "👎 Dislike";
    if (profile.dislikes.includes(recipe.Recipe)) dislikeBtn.classList.add("active");

    const saveBtn = document.createElement("button");
    saveBtn.classList.add("action-btn", "save");
    saveBtn.textContent = "🔖 Save";
    if (profile.saved.includes(recipe.Recipe)) saveBtn.classList.add("active");

    const ratingBar = buildRatingBar(recipe.Recipe);

    likeBtn.addEventListener("click", () => {
      const wasLiked = profile.likes.includes(recipe.Recipe);
      const wasDisliked = profile.dislikes.includes(recipe.Recipe);

      toggleArrayValue(profile, "likes", recipe.Recipe);
      adjustStat(recipe.Recipe, "likes", wasLiked ? -1 : 1);

      if (!wasLiked && wasDisliked) {
        toggleArrayValueOff(profile, "dislikes", recipe.Recipe);
        adjustStat(recipe.Recipe, "dislikes", -1);
        dislikeBtn.classList.remove("active");
      }

      persistProfile(profile);
      likeBtn.classList.toggle("active");
      ratingBar.refresh();
    });

    dislikeBtn.addEventListener("click", () => {
      const wasDisliked = profile.dislikes.includes(recipe.Recipe);
      const wasLiked = profile.likes.includes(recipe.Recipe);

      toggleArrayValue(profile, "dislikes", recipe.Recipe);
      adjustStat(recipe.Recipe, "dislikes", wasDisliked ? -1 : 1);

      if (!wasDisliked && wasLiked) {
        toggleArrayValueOff(profile, "likes", recipe.Recipe);
        adjustStat(recipe.Recipe, "likes", -1);
        likeBtn.classList.remove("active");
      }

      persistProfile(profile);
      dislikeBtn.classList.toggle("active");
      ratingBar.refresh();
    });

    saveBtn.addEventListener("click", () => {
      toggleArrayValue(profile, "saved", recipe.Recipe);
      persistProfile(profile);
      saveBtn.classList.toggle("active");
    });

    actionRow.appendChild(likeBtn);
    actionRow.appendChild(dislikeBtn);
    actionRow.appendChild(saveBtn);

    card.appendChild(title);
    card.appendChild(tagContainer);
    card.appendChild(macros);
    card.appendChild(ingredients);
    card.appendChild(instructions);
    card.appendChild(actionRow);
    card.appendChild(ratingBar.element);

    resultsDiv.appendChild(card);
  });
}

function buildRatingBar(recipeName) {
  const wrap = document.createElement("div");
  wrap.classList.add("rating-bar-wrap");

  const bar = document.createElement("div");
  bar.classList.add("rating-bar");

  const fill = document.createElement("div");
  fill.classList.add("rating-bar-fill");
  bar.appendChild(fill);

  const percentText = document.createElement("div");
  percentText.classList.add("rating-percent");

  wrap.appendChild(bar);
  wrap.appendChild(percentText);

  function refresh() {
    const stats = getRecipeStats(recipeName);
    const total = stats.likes + stats.dislikes;
    const pct = total === 0 ? 0 : Math.round((stats.likes / total) * 100);

    fill.style.width = pct + "%";
    percentText.textContent =
      total === 0
        ? "No ratings yet"
        : `${pct}% liked (${total} rating${total === 1 ? "" : "s"})`;
  }

  refresh();
  return { element: wrap, refresh };
}

function toggleArrayValue(profile, field, value) {
  const idx = profile[field].indexOf(value);
  if (idx === -1) {
    profile[field].push(value);
  } else {
    profile[field].splice(idx, 1);
  }
}

function toggleArrayValueOff(profile, field, value) {
  const idx = profile[field].indexOf(value);
  if (idx !== -1) profile[field].splice(idx, 1);
}

function persistProfile(profile) {
  const profiles = getProfiles();
  profiles[currentUser] = profile;
  saveProfiles(profiles);
}
