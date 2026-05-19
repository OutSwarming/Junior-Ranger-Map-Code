const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const csvFiles = [
    {
        path: path.join(repoRoot, '02-data', 'data', 'data.csv'),
        header: 'name,state,swagType,lat,lng,info,website'
    },
    {
        path: path.join(repoRoot, '02-data', 'data', 'sheet_data_fetched.csv'),
        header: 'Location,State,Swag Cost,Type, Useful/Important/Other Info,Website,"Swag Pics - If available, and may not be current.",lat,lng'
    }
];

const hostedFallbackCsv = {
    path: path.join(repoRoot, '01-code', 'app', 'assets', 'data', 'jr-fallback.csv'),
    requiredHeaders: ['siteID', 'siteName', 'latitude', 'longitude', 'state', 'specialPrograms']
};

test('repo CSV data files do not contain unresolved git conflict markers', () => {
    for (const file of csvFiles) {
        const contents = fs.readFileSync(file.path, 'utf8');
        assert.doesNotMatch(contents, /^(<<<<<<<|=======|>>>>>>>) /m, `${file.path} contains conflict markers`);
    }
});

test('repo CSV data files keep their expected headers after conflict repair', () => {
    for (const file of csvFiles) {
        const firstLine = fs.readFileSync(file.path, 'utf8').split(/\r?\n/, 1)[0];
        assert.equal(firstLine, file.header, `${file.path} header changed unexpectedly`);
    }
});

test('hosted fallback CSV is deployable and contains canonical park ids', () => {
    const contents = fs.readFileSync(hostedFallbackCsv.path, 'utf8');
    assert.doesNotMatch(contents, /^(<<<<<<<|=======|>>>>>>>) /m, `${hostedFallbackCsv.path} contains conflict markers`);

    const firstLine = contents.split(/\r?\n/, 1)[0];
    for (const header of hostedFallbackCsv.requiredHeaders) {
        assert.match(firstLine, new RegExp(`(^|,)"?${header}"?(,|$)`, 'i'), `${hostedFallbackCsv.path} is missing ${header}`);
    }

    const lineCount = contents.split(/\r?\n/).filter(Boolean).length;
    assert.ok(lineCount > 300, `${hostedFallbackCsv.path} should contain the official fallback dataset`);
});

test('hosted fallback CSV keeps Junior Ranger coordinates for Acadia', () => {
    const contents = fs.readFileSync(hostedFallbackCsv.path, 'utf8');

    assert.match(contents, /"jr_acadia_national_park"/, 'Acadia National Park must be present in the hosted Junior Ranger fallback CSV');
    assert.match(contents, /"44\.3385559","-68\.2733346"/, 'Acadia National Park must keep its latitude/longitude populated');
});

test('hosted fallback CSV separates Junior Ranger Fort Caroline and Kingsley coordinates', () => {
    const contents = fs.readFileSync(hostedFallbackCsv.path, 'utf8');

    assert.match(
        contents,
        /Fort Caroline National Memorial[\s\S]*?"30\.3853866","-81\.4973666"/,
        'Fort Caroline must use the Junior Ranger Fort Caroline coordinates'
    );
    assert.match(
        contents,
        /Kingsley Plantation[\s\S]*?"30\.4398902","-81\.4378092"/,
        'Kingsley Plantation must use separate Junior Ranger Kingsley coordinates'
    );
});
