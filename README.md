# Stellar Drift

A browser-based Newtonian space flight simulator. You fly a fusion-drive ship through the real Solar System and ten nearby star systems with known exoplanets.

Built with **Three.js + TypeScript + Vite**. It runs in any modern desktop browser with WebGL2.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Publish on Replit

1. Create a new Repl by importing this folder (or a GitHub repo of it). Replit picks up `.replit` automatically.
2. Press **Run** to start the dev server inside Replit.
3. To publish, open **Deploy → Static**. The build command (`npm run build`) and public directory (`dist`) are already set in `.replit`.

The game is a static site, so no server or database is needed.

## Features

- **Newtonian physics**: patched n-body gravity from every significant body, leapfrog integration with adaptive sub-stepping, and drag in rotating atmospheres. It also computes heating, dynamic pressure and live orbital elements (Ap, Pe, period).
- **Real data**:
  - Solar System bodies use JPL J2000 orbital elements, and positions match the real calendar date.
  - 45 bodies: the 8 planets, 24 moons, 5 dwarf planets, Vesta, Pallas and Halley's Comet.
- **10 exoplanet systems**: Proxima Centauri, Barnard's Star, Wolf 359, Lalande 21185, Epsilon Eridani, Ross 128, Tau Ceti, Gliese 876, TRAPPIST-1 and 55 Cancri. Each uses published masses, orbits and stellar data. The surfaces are science-informed artist's impressions.
- **Travel mode**: **FAST | ECONOMY** in the Target panel, remembered between sessions.
  - **FAST** accelerates to the halfway point and brakes.
  - **ECONOMY** cruises at a tenth of the speed, using roughly a tenth of the fuel and taking about five times as long. For example, Earth → Mars is 18 h and 1.2 t fast, or 4.8 days and 0.1 t economy.
  - The TRIP readout shows the chosen mode's time and fuel, and its tooltip compares both.
- **Ground and dock rule**: while landed or docked, the only autopilot action is getting airborne: **LIFT OFF TO ORBIT** (**C**) when landed, **UNDOCK** or **LIFT OFF** (**U**) when docked. All other options, including jumps, return once you're flying.
- **Autopilot**:
  - Fly to & orbit any body.
  - Land anywhere solid.
  - Circularise your current orbit. When landed, this button becomes **LIFT OFF TO ORBIT**, which climbs to a parking orbit around the body you're on.
  - Time warp is managed automatically during autopilot manoeuvres.
- **Jump drive** between star systems. Jumps cost fuel per light-year.
  - **Arm it:** select a system and press **J**. The autopilot turns the ship to face the target star.
  - **Spool up:** hold **W**; arming sets drive power to maximum for you. While the ship is aligned within 2° and burning at full power, the drive spools for 2 seconds and then jumps. Time runs at 1× while the drive is armed, since the spool-up burn is timed in real seconds.
  - **Safety:** the drive won't arm if a planet's surface or atmosphere lies along the jump vector within 500 km. Let your orbit carry you round, or climb higher, and try again.
  - **Status:** a checklist box shows alignment, power and spool progress. In cockpit view the HUD marks the jump vector.
  - **Camera:** while the drive spools and through the transit, the camera swings round to directly behind the ship (switching out of cockpit view). Your view and zoom come back once the arrival flash has cleared.
  - **Transit:** once spooled, the jump is committed. For 1.8 s stars stream out of the jump point and stretch into accelerating streaks as the view widens and a rising roar builds. The screen whites out, you arrive at the peak of the flash, and the streaks slow and fade as it clears.
- **NPC traffic**: up to 3 other ships fly their own routes in the system you're in, between stations, planets and (for mining ships) asteroids.
  - They use the same detailed ship models and engine plumes, and flip-and-burn to brake on arrival.
  - At stations they arrive and leave through the lower traffic port, leaving the upper port for you.
  - They appear as orange markers with name, ship type and destination, as orange blips on the radar, and on the system map.
  - **Target a ship:** click its blip on the radar (body blips work too) or its on-screen marker. The target panel shows its type, status and range, and the cockpit HUD brackets it with range and closing speed.
  - **Rendezvous:** **RENDEZVOUS** (**G**) undocks if needed, chases the ship (steering around planets in the way), brakes, matches its velocity and keeps station a few hundred metres off. It stays with the ship as it manoeuvres or docks (holding 900 m off a station) until you press **X**. You can use time warp while holding station.
- **20 uncharted systems**: real nearby stars with confirmed exoplanets that nobody has visited.
  - **The stars:** Lacaille 9352, Groombridge 34, Epsilon Indi, Gliese 1061, YZ Ceti, Luyten's Star, Teegarden's Star, Wolf 1061, Gliese 687, Gliese 674, Gliese 1002, Gliese 832, Gliese 229, Gliese 581, HD 219134, LTT 1445, Gliese 667 C, 61 Virginis, AU Microscopii and Gliese 436.
  - They have no stations or traffic, just their planets (published parameters) and an untouched asteroid belt.
  - **Belts:** each has six rich asteroids. These include **X-type** (exotic) rocks carrying **Iridium**, **Rhodium**, **Xenocrystals** and traces of **Exotic Matter** (worth up to 36,000 cr/t), and **H-type** rocks rich in Helionite fuel.
  - **Selling:** these rare finds can't be bought anywhere, but every station pays for them. Research stations pay most for Xenocrystals and Exotic Matter.
  - **Survey bonus:** your first arrival in each system pays 1,250 cr. The galaxy map and star list mark unvisited ones as UNCHARTED.
- **Galaxy map**: the map (**M**) opens on a rotatable 3D chart of the local neighbourhood in galactic coordinates.
  - Height lines show each star above or below the galactic plane.
  - Jumpable systems show their distance and fuel cost, coloured by whether you can reach them.
  - The jump route to your target is drawn, well-known nearby stars are included for context, and a Milky Way inset shows where you are.
  - Click a system to target it. The SYSTEM tab switches back to the orbital map.
- **Trading career**:
  - 15 space stations (Earth, Moon, Mars, Titan, Pluto, plus one in each exoplanet system), plus 5 ground spaceports on Earth and 5 ground bases on the Moon, Mars, Titan and Pluto.
  - 22 real and fictional commodities. Prices depend on each station's economy, drift over time, and react to your own trades. Commodity prices are balanced so that working up the ship ladder (Prospector 75,000 cr up to Atlas 5.2 M cr) takes real effort: an ice haul in the Kestrel pays a few thousand credits, and even an exotic-matter run in uncharted space pays a few hundred thousand per hold.
  - You earn credits and your career is saved in the browser, including where your ship is (docked, landed or in flight). It autosaves every 20 seconds and resumes there. To back it up or move it to another browser, device or site, use **EXPORT SAVE** in the help panel (H): it downloads your career as a .json file. **IMPORT SAVE** (click twice, then choose the file) replaces the current career with that file's.
  - **Cargo hold:** click **CARGO** in the top bar, or press **I**. The panel lists every commodity aboard with its quantity, what you paid (or MINED), and what it's worth: here when docked, otherwise at the best-paying station in the system. You can sell a whole lot when docked, or jettison cargo in flight.
  - **Price comparison:** in a station's market, **Compare prices with** shows live prices from any other station, the best price in the current system, or the best price anywhere. A margin column shows what you'd make per tonne by buying here and selling there; you can sort by it. A summary suggests the best haul you can carry and afford, and **Set as target** points the autopilot at that station (or its star system).
  - **Contracts:** every station has a **CONTRACTS** board with five offers that change every two days. You can hold up to 4 at once.
    - **Courier:** deliver sealed cargo. It takes hold space and can't be sold.
    - **Passengers:** carry people. Their cabins take 1 t of hold space each, and deadlines are tighter.
    - **Procurement:** buy or mine the goods yourself and bring them to the destination.
    - **Survey (Orbital Survey Office):** three steps, each ticked off on the contract card. Jump to the named uncharted system (no station there, so carry spare Helionite). Target the named planet or asteroid and scan it with the scope's **SCAN** button from within 200,000 km. Then bring the data back to the station that issued the contract and dock there to get paid. **SET TARGET** always points at the next step.
    - Payment is automatic when you dock at the destination (procurement: with the goods aboard; surveys: with the scan data). Time limits start when you accept and are set so even the slowest ship, fully laden and flying in **economy** mode, makes it comfortably: at least about 1.6× the autopilot's economy flight time, plus time to undock, dock and (for procurement) buy the goods. A missed deadline or an abandoned contract costs the penalty shown. Track active contracts in **LOG → CONTRACTS**, where **SET TARGET** points the autopilot at the destination.
  - **Running costs:** every ship costs 0.4% of its price per game day in crew wages and maintenance (Kestrel 160 cr/day, Behemoth 7,600 cr/day), and each docking incurs port charges. Costs build up while you fly and are settled automatically at the next station. While you owe money you can't buy ships. Big ships earn more but are expensive to leave idle.
  - **Raiders:** carrying valuable cargo through open space can bring a pirate interceptor alongside. The risk grows with the cargo's value, is highest in uncharted space and lowest in Sol, and there are none near stations. Time warp is held at 10× while they're near. Raiders strike at most once per flight: after an encounter you're left alone until you've docked or landed and set off again.
    - They demand 25% of the cargo's value and give you 45 seconds to answer. **PAY**, or escape: out-run them at full drive power (get 80 km clear), reach a station's patrol zone, land, or jump out.
    - Fast, lightly loaded ships can out-run them; laden haulers can't. Ignore them and they board you and take half your hold, including any sealed contract cargo.
  - **Career log (Z, or LOG in the top bar):** contracts, stats and logbook.
    - **STATS:** earnings by source (trade, mining, contracts, surveys, fleet), spending by category, net credits per game day and per hour played, running costs, your best routes, and career totals (distance, dockings, jumps, tonnes mined and sold, contracts, raider encounters, crashes).
    - **LOGBOOK:** a dated log of everything that happened.
  - **Fleet:** at any shipyard, **ADD TO FLEET** buys a ship (full price, up to 5) and hires a crew. In the station dialog's **FLEET** tab (at any station), pick two stations for its trade loop.
    - The crew flies the loop and wires you the profit at the end of each one, minus their 25% share. Each loop shows its length, cargo, profit per loop and profit per day against upkeep.
    - Fleet ships pay running costs even when idle. About 1 loop in 25 is lost en route, and fleet ships sell back for 60% of their price. A Heron on the Gateway ⇄ Tranquility Hub loop takes about 3 weeks to pay for itself.
- **Ground spaceports on Earth**: Cape Canaveral, Starbase, Baikonur, the Guiana Space Centre (Kourou) and Tanegashima, at (or, for Cape Canaveral, just inland of) their real locations.
  - Each is a full station on the ground, with a market, refuelling and a shipyard. Anything made on Earth is cheap there, and anything from space sells high.
  - **Finding them:** SCAN Earth to list them, with a **TARGET** button each. They also appear under Earth in the destinations list.
  - **Landing:** **LAND AT PAD** (**L**) crosses above the atmosphere, descends with speeds capped in the air, sets down on the pad and docks. Landing by hand within about 250 m of a pad docks you too.
  - **Leaving:** **LIFT OFF** climbs straight up from the pad, then carries on to a parking orbit.
- **Ground bases beyond Earth**: Tranquility Base and Shackleton Base on the Moon, Jezero Base on Mars, Selk Base on Titan and Sputnik Base on Pluto, at landmark sites. They work like the Earth spaceports, each with its world's economy. Scan the world to list them.
- **Five trading ships** with increasing cargo, fuel tank, size and price: Kestrel, Heron, Albatross, Leviathan and Atlas. Buy them at any shipyard; your current ship is taken in trade.
- **Wraith (stealth mining carrier, 10,000,000 cr):** an Atlas-sized hold (1,100 t), a 140 t/h four-drill mining rig that recovers everything, 6.0 g autopilot acceleration, and a radar-absorbing hull: raiders never intercept it. A black faceted blade with swept wings, canards, canted tail fins, red edge glow and a six-torch drive.
- **Asteroid mining**:
  - The Solar System's asteroid belt has 10 more real asteroids: Hygiea, Juno, Psyche, Eunomia, Davida, Interamnia, Sylvia, Hebe, Iris and Bamberga. Ceres, Vesta and Pallas can be mined too.
  - Every other star system has its own belt of 5 catalogued asteroids.
  - **Ore types:** C-type yields water and volatiles, S-type yields iron, titanium and rare earths, and M-type is metal-rich with platinum. Each asteroid also has its own richness.
  - **Three mining ships:** the Prospector (35 t, 8 t/h), the Excavator (140 t, 30 t/h) and the Behemoth (500 t, 110 t/h).
  - **What your drill can take:** deposits your rig can't work are marked NO RIG in the scan. Targeting or drilling one tells you what you'd actually recover, and the mining panel lists what's going into the hold.
  - **The Kestrel's ice drill:** the starter ship can mine too, but only water ice and frozen Helionite. It recovers the ice share of the rock and leaves the rest. That's about 2.7 t/h on a rich C-type asteroid, much less on S-types, and nothing on metallic M-types. SCAN mode dims the ores it can't recover.
  - **How to mine:** land on an asteroid and press **K** or START MINING. The drill rig lowers a telescoping shaft from the belly, and the spinning auger bores into the ground, throwing up dust and cuttings. Time warp speeds it up, and mining burns fuel. Mined ore sells at any station like any other commodity.
  - **Surface deposits:** every mineable body has 3–4 deposits at fixed spots on its surface, each rich in one commodity, such as an ice-filled crater or a platinum vein. A deposit gives 55–75% of that commodity at 1.25–1.8× richness. Drilling anywhere else only reaches thin regolith at 60% richness.
    - **Find them:** a scan marks the deposits on the body and lists them. Click a row to see its composition and yield for your ship, or **TARGET** to make it the landing site.
    - **Land on them:** with a site targeted, **LAND AT SITE X** (**L**) flies across to it at a safe height and sets down on it. If you're already landed on the body, the button becomes **HOP TO SITE X**.
    - **Fly by hand:** an amber diamond marks the site on the surface, with its ground distance and your height above it, dimmed when it's on the far side. The cockpit HUD shows it too, with an arrow when it's off-screen. The magenta steering cue leads to a hover point 150 m above the site.
  - **SCAN mode:** a new mode on the right display scans the target from up to 200,000 km. It shows the ore class, richness and composition, the best sell prices in the system, and your expected yield in t/h and credits per hour.
- **Helionite fuel**: frozen deuterium–helium-3 fusion pellets, and the fuel in every drive.
  - Every burn and jump uses it, and more when you're heavily laden.
  - Refuelling buys Helionite at the station's market price: cheapest at gas-giant refineries and Titan, dearest on the frontier.
  - It's also a tradeable commodity. Buy it into the hold, haul it and sell it, or mine it from H-type and X-type asteroids. The Kestrel's ice drill can cut it too.
  - Helionite in the hold can be loaded into the tank anywhere, using **LOAD TANK** in the cargo hold (**I**).
  - If you run dry, **REQUEST TOW** (in the autopilot panel; click twice to confirm) takes you to the nearest space station in the system for **10,000 cr**, or all you have if that's less. There's no tow in systems without a station, so carry spare Helionite in uncharted space.
- **Context-aware controls**: commands that would do nothing are greyed out, with the reason in the tooltip. Examples: LAND when you're already landed there, DOCK where you're docked, CIRCULARISE on the ground or in an already circular orbit, a manoeuvre that's already running, or LAND on a gas giant. The G, L and C keys follow the same rules and say why.
- **Autopilot docking**: approach, swing round to the docking axis, then make the final slow approach.
- **Landing gear**: a selector on the instrument bar (or **Y**) cycles AUTO, DOWN and UP.
  - **AUTO** lowers the legs near the ground and raises them after take-off.
  - Descending toward the ground with the gear up triggers a warning. Touching down that way is a belly landing.
  - Autopilot landings always switch the gear back to AUTO, and keep the wings level all the way down.
- **Autopilot undocking**: **UNDOCK** (or **U**) backs the ship straight out of the port to about 1.3 km and holds there. Any autopilot command given while docked (fly to, land, dock elsewhere, circularise) undocks this way first, then carries on.
- **Sound effects**, all synthesised in the browser: engine rumble that follows thrust, RCS hiss, wind and re-entry roar in atmospheres, mining drills, jump-drive spool and arrival, docking clamps, touchdowns, message chimes and button clicks. Toggle with **SOUND** in the top bar or **P**.
- **Scope display** (collapsible panel, collapsed by default; click its header to open) in three modes:
  - **Radar:** objects around you, with stalks showing height above or below.
  - **From:** your orbit around the body you're near.
  - **To:** your position relative to the target's orbit.
- **Cockpit view**: a 3D interior with live console screens, plus a heads-up display with pitch ladder, heading, flight-path marker, target designator and warnings.
- **Auto-prograde**: in manual flight, after 3 seconds with no steering or thrust input the ship gently turns its nose into its direction of travel. This doesn't happen when hovering low over a surface. Any input takes control straight back.
- **Manual steering cue**: with the autopilot off, a magenta diamond shows where to point and burn to reach the target.
  - Point the nose at it and hold **W** until it reads COAST.
  - Then follow it round for the braking burn.
- **Crashes**: touching down faster than 20 m/s, or faster than 8 m/s with the gear up, is a crash. So is sinking too deep into a gas giant or flying too close to a star.
  - The ship is patched up, but you lose **10% of your credits** in medical expenses, with a red flash, a jolt and an impact sound.
  - Landings at 8–20 m/s are hard landings: a warning only.
  - The autopilot looks ahead along its ground track for rising terrain, and avoids planets in its path.
- **Landing lights**: below about 1.5 km over a surface, a forward beam and a wide belly floodlight light the terrain ahead of and directly under the ship, strongest on the night side. The forward beam tilts further ahead near the ground.
- **Seamless planetary landing**:
  - Quadtree cube-sphere terrain with procedural relief and craters.
  - Earth's terrain follows its real coastlines.
  - Physically based atmospheric scattering, using each body's real scale height and composition.
- **Visuals**:
  - NASA-derived planet maps, Earth city lights and clouds.
  - Saturn's rings with planet shadow.
  - HDR bloom, engine plumes and re-entry glow.
  - Chase and cockpit cameras.

## Controls

| Key | Action |
| --- | --- |
| W / S | Thrust forward / back |
| A / D, R / F | Thrust left / right, up / down |
| Arrows or left-drag | Pitch & yaw |
| Q / E | Roll |
| + / − | Drive power |
| , / . / / | Time warp slower / faster / real time |
| Right-drag, wheel | Orbit / zoom camera |
| V / M / O / H | View, system map, orbit lines, help |
| G / L / C / X | Autopilot: orbit (or approach) / land or dock / circularise / off |
| J | Jump to the selected star system |
| T / U | Station services (market, shipyard) / autopilot undock |
| P | Sound on / off |
| Y | Landing gear: AUTO / DOWN / UP |
| I | Cargo hold manifest |
| N / B | Collapse navigation panel / cycle scope mode |
| K | Start / stop mining (landed on an asteroid in a mining ship) |

## Credits

Planet textures are from [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0) and are based on NASA imagery.
