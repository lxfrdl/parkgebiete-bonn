// src/App.js
import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Converts a raw `parkgebiet_name` like "E = alter Friedhof"
 * into a display string "E Alter Friedhof".
 */
function getDisplayName(rawName) {
  const parts = rawName.split("=");
  if (parts.length !== 2) {
    return rawName.trim();
  }
  const code = parts[0].trim();          // e.g. "E"
  const titlePart = parts[1].trim();     // e.g. "alter Friedhof"
  const titled = titlePart
    .split(" ")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
  return `${code} ${titled}`;
}

function App() {
  // 1. State: two GeoJSON datasets, union of raw parkgebiet_name values, and selected filter
  const [segmentsData, setSegmentsData] = useState(null);
  const [numbersData, setNumbersData] = useState(null);
  const [rawNames, setRawNames] = useState([]);
  const [selectedRawName, setSelectedRawName] = useState("__ALL__");

  // 2. Ref to the Leaflet map instance for fitting bounds
  const mapRef = useRef(null);

  // 3. Fetch both JSONs on mount
  useEffect(() => {
    const segPath = `${process.env.PUBLIC_URL}/parkgebiete-strassenabschnitt.json`;
    const numPath = `${process.env.PUBLIC_URL}/parkgebiete-strassennummer.json`;

    Promise.all([fetch(segPath), fetch(numPath)])
      .then(async ([segRes, numRes]) => {
        if (!segRes.ok) throw new Error("Segments JSON not found");
        if (!numRes.ok) throw new Error("Numbers JSON not found");
        const segJson = await segRes.json();
        const numJson = await numRes.json();
        return [segJson, numJson];
      })
      .then(([segJson, numJson]) => {
        setSegmentsData(segJson);
        setNumbersData(numJson);

        // Build a set of all unique parkgebiet_name in both datasets
        const namesSet = new Set();
        segJson.features.forEach((f) => {
          const pname = f.properties?.parkgebiet_name;
          if (pname) namesSet.add(pname);
        });
        numJson.features.forEach((f) => {
          const pname = f.properties?.parkgebiet_name;
          if (pname) namesSet.add(pname);
        });
        setRawNames(Array.from(namesSet).sort());

        // After both are loaded, fit bounds to the union of segments & numbers
        const segLayer = L.geoJSON(segJson);
        const numLayer = L.geoJSON(numJson);
        let combinedBounds = null;
        if (segLayer.getBounds().isValid()) {
          combinedBounds = segLayer.getBounds();
        }
        if (numLayer.getBounds().isValid()) {
          combinedBounds = combinedBounds
            ? combinedBounds.extend(numLayer.getBounds())
            : numLayer.getBounds();
        }
        if (combinedBounds && mapRef.current) {
          mapRef.current.fitBounds(combinedBounds, { padding: [20, 20] });
        }
      })
      .catch((err) => {
        console.error(err);
        alert("Error loading GeoJSON files—check console");
      });
  }, []);

  // 4. Compute a distinct HSL color for each rawName group
  const groupColorMap = useMemo(() => {
    if (!rawNames.length) return {};
    const total = rawNames.length;
    return rawNames.reduce((acc, name, idx) => {
      // Distribute hues evenly around the circle
      const hue = Math.round((idx * 360) / total);
      acc[name] = `hsl(${hue}, 70%, 50%)`;
      return acc;
    }, {});
  }, [rawNames]);

  // 5. Style callback for segments:
  //    - If feature belongs to selectedRawName, use its group color.
  //    - Otherwise use its group color, unless filtering, then gray out.
  const segmentStyle = useCallback(
    (feature) => {
      const pname = feature.properties?.parkgebiet_name;
      const baseColor = groupColorMap[pname] || "#666666";
      if (selectedRawName === "__ALL__") {
        return {
          color: baseColor,
          weight: 2,
          opacity: 0.7,
        };
      }
      // Filtering active: highlight matching group, gray out others
      if (pname === selectedRawName) {
        return {
          color: baseColor,
          weight: 3,
          opacity: 0.9,
        };
      }
      return {
        color: "#cccccc",
        weight: 1,
        opacity: 0.4,
      };
    },
    [groupColorMap, selectedRawName]
  );

  // 6. Style callback for numbers (points):
  //    - If feature belongs to selectedRawName, use its group color.
  //    - Otherwise use its group color, unless filtering, then gray out.
  const numberPointToLayer = useCallback(
    (feature, latlng) => {
      const pname = feature.properties?.parkgebiet_name;
      const baseColor = groupColorMap[pname] || "#666666";
      let style = {};
      if (selectedRawName === "__ALL__") {
        style = {
          color: baseColor,
          radius: 5,
          weight: 1,
          opacity: 0.7,
          fillOpacity: 0.6,
        };
      } else {
        if (pname === selectedRawName) {
          style = {
            color: baseColor,
            radius: 7,
            weight: 2,
            opacity: 0.9,
            fillOpacity: 0.8,
          };
        } else {
          style = {
            color: "#cccccc",
            radius: 4,
            weight: 1,
            opacity: 0.3,
            fillOpacity: 0.2,
          };
        }
      }
      return L.circleMarker(latlng, style);
    },
    [groupColorMap, selectedRawName]
  );

  // 7. onEachFeature for segments: bind a popup showing basic info
  const onEachSegment = useCallback((feature, layer) => {
    const props = feature.properties || {};
    const pname = props.parkgebiet_name || "–";
    const buchstabe = props.parkgebiet_buchstabe || "–";
    const bereich = props.bereich || "–";
    const html = `
      <div style="font-size:14px; line-height:1.3;">
        <strong>${getDisplayName(pname)}</strong><br/>
        Buchstabe: ${buchstabe}<br/>
        Bereich: ${bereich}
      </div>
    `;
    layer.bindPopup(html);
  }, []);

  // 8. onEachFeature for numbers (points): bind a popup showing detailed info
  const onEachNumber = useCallback((feature, layer) => {
    const props = feature.properties || {};
    const pname = props.parkgebiet_name || "–";
    const langname = props.langname || "–";
    const hausnr = props.hausnr || "–";
    const objekt = props.objekt || "–";
    const html = `
      <div style="font-size:14px; line-height:1.3;">
        <strong>${getDisplayName(pname)}</strong><br/>
        Straße: ${langname}<br/>
        Hausnr.: ${hausnr}<br/>
        Objekt: ${objekt}
      </div>
    `;
    layer.bindPopup(html);
  }, []);

  // 9. Auto-zoom on filter change:
  //    - If "__ALL__", show overall bounds (set once on load).
  //    - Otherwise, compute bounds of all segments + points that match selectedRawName and fit bounds.
  useEffect(() => {
    if (!segmentsData || !numbersData) return;

    // If no specific filter, keep the initial overall view (no change).
    if (selectedRawName === "__ALL__") return;

    // Otherwise, gather matching features from both datasets
    const matchingSegs = segmentsData.features.filter(
      (f) => f.properties?.parkgebiet_name === selectedRawName
    );
    const matchingNums = numbersData.features.filter(
      (f) => f.properties?.parkgebiet_name === selectedRawName
    );

    let combinedBounds = null;
    if (matchingSegs.length > 0) {
      const tempSegLayer = L.geoJSON({
        type: "FeatureCollection",
        features: matchingSegs,
      });
      combinedBounds = tempSegLayer.getBounds();
    }
    if (matchingNums.length > 0) {
      const tempNumLayer = L.geoJSON({
        type: "FeatureCollection",
        features: matchingNums,
      });
      const numBounds = tempNumLayer.getBounds();
      combinedBounds = combinedBounds
        ? combinedBounds.extend(numBounds)
        : numBounds;
    }

    if (combinedBounds && mapRef.current) {
      mapRef.current.fitBounds(combinedBounds, { padding: [20, 20] });
    }
  }, [selectedRawName, segmentsData, numbersData]);

  // 10. Initial map center & zoom (fallback if bounds not yet set)
  const position = [50.73148, 7.10719];
  const zoom = 15;

  return (
    <div style={{ height: "100vh", position: "relative" }}>
      {/* Control Panel moved to top-right */}
      <div
        style={{
          position: "absolute",
          top: 10,
          right: 10,       /* ← use right instead of left */
          zIndex: 1000,
          background: "white",
          padding: "8px 12px",
          borderRadius: 4,
          boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
          fontFamily: "Arial, sans-serif",
          fontSize: 14,
        }}
      >
        <label htmlFor="nameSelect">
          <strong>Filter Parkgebiet: </strong>
        </label>
        <select
          id="nameSelect"
          value={selectedRawName}
          onChange={(e) => setSelectedRawName(e.target.value)}
          style={{ fontSize: 14, marginLeft: 6 }}
        >
          <option value="__ALL__">– alle –</option>
          {rawNames.map((raw) => (
            <option key={raw} value={raw}>
              {getDisplayName(raw)}
            </option>
          ))}
        </select>
      </div>

      {/* Map Container */}
      <MapContainer
        center={position}
        zoom={zoom}
        style={{ height: "100%", width: "100%" }}
        whenCreated={(mapInstance) => {
          mapRef.current = mapInstance;
        }}
      >
        {/* OSM Base Layer */}
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="© OpenStreetMap contributors"
        />

        {/* Segments Layer */}
        {segmentsData && (
          <GeoJSON
            key={`seg-${selectedRawName}`}
            data={segmentsData}
            style={segmentStyle}
            onEachFeature={onEachSegment}
          />
        )}

        {/* Numbers (Points) Layer */}
        {numbersData && (
          <GeoJSON
            key={`num-${selectedRawName}`}
            data={numbersData}
            pointToLayer={numberPointToLayer}
            onEachFeature={onEachNumber}
          />
        )}
      </MapContainer>
    </div>
  );
}

export default App;
