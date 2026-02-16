import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyServiceClass,
  extractRailContextFromGtfsTables,
  parseCsv,
} from "./railContextGtfs.js";

test("classifyServiceClass maps heavy and commuter route types", () => {
  assert.equal(classifyServiceClass("1"), "heavy");
  assert.equal(classifyServiceClass("2"), "commuter");
  assert.equal(classifyServiceClass("3"), null);
});

test("extractRailContextFromGtfsTables de-duplicates repeated trip shapes", () => {
  const routes = [
    { route_id: "A", route_type: "1", route_short_name: "A", route_long_name: "Metro A" },
    { route_id: "CR", route_type: "2", route_short_name: "CR", route_long_name: "Commuter Rail" },
  ];
  const trips = [
    { route_id: "A", shape_id: "shape_a_1" },
    { route_id: "A", shape_id: "shape_a_1" }, // duplicate trip using same shape
    { route_id: "CR", shape_id: "shape_cr_1" },
  ];
  const shapes = [
    { shape_id: "shape_a_1", shape_pt_lat: "44.1", shape_pt_lon: "-93.1", shape_pt_sequence: "1" },
    { shape_id: "shape_a_1", shape_pt_lat: "44.2", shape_pt_lon: "-93.2", shape_pt_sequence: "2" },
    { shape_id: "shape_cr_1", shape_pt_lat: "44.3", shape_pt_lon: "-93.3", shape_pt_sequence: "1" },
    { shape_id: "shape_cr_1", shape_pt_lat: "44.4", shape_pt_lon: "-93.4", shape_pt_sequence: "2" },
  ];
  const agency = [{ agency_name: "Test Transit" }];

  const result = extractRailContextFromGtfsTables(
    { routes, trips, shapes, agency },
    { dissolveByRoute: true },
  );

  assert.equal(result.heavy.features.length, 1);
  assert.equal(result.commuter.features.length, 1);
  assert.equal(result.heavy.features[0].properties.route_id, "A");
  assert.equal(result.commuter.features[0].properties.route_id, "CR");
  assert.equal(result.heavy.features[0].properties.agency_name, "Test Transit");
});

test("parseCsv strips UTF-8 BOM from header names", () => {
  const csv = "\uFEFFroute_id,route_type\nA,2\n";
  const rows = parseCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].route_id, "A");
  assert.equal(rows[0].route_type, "2");
});

test("extractRailContextFromGtfsTables supports route include filters", () => {
  const routes = [
    { route_id: "A", route_type: "2", route_short_name: "ATLC", route_long_name: "Atlantic City" },
    { route_id: "B", route_type: "2", route_short_name: "NEC", route_long_name: "Northeast Corridor" },
  ];
  const trips = [
    { route_id: "A", shape_id: "shape_a" },
    { route_id: "B", shape_id: "shape_b" },
  ];
  const shapes = [
    { shape_id: "shape_a", shape_pt_lat: "39.9", shape_pt_lon: "-75.1", shape_pt_sequence: "1" },
    { shape_id: "shape_a", shape_pt_lat: "39.8", shape_pt_lon: "-75.0", shape_pt_sequence: "2" },
    { shape_id: "shape_b", shape_pt_lat: "40.1", shape_pt_lon: "-74.9", shape_pt_sequence: "1" },
    { shape_id: "shape_b", shape_pt_lat: "40.2", shape_pt_lon: "-74.8", shape_pt_sequence: "2" },
  ];
  const agency = [{ agency_name: "Test Transit" }];

  const result = extractRailContextFromGtfsTables(
    { routes, trips, shapes, agency },
    { dissolveByRoute: true, includeRouteShortNames: ["ATLC"] },
  );

  assert.equal(result.commuter.features.length, 1);
  assert.equal(result.commuter.features[0].properties.route_short_name, "ATLC");
});
