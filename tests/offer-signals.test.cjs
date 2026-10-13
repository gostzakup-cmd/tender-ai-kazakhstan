const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({});
vm.runInContext(fs.readFileSync('OfferSignals.gs','utf8'),c);
const good={
 '@type':'Offer',inventoryLevel:{'@type':'QuantitativeValue',value:12,unitCode:'C62'},
 shippingDetails:{'@type':'OfferShippingDetails',
 shippingDestination:{'@type':'DefinedRegion',addressCountry:'KZ'},
 deliveryTime:{'@type':'ShippingDeliveryTime',handlingTime:{'@type':'QuantitativeValue',maxValue:2,unitCode:'DAY'},
 transitTime:{'@type':'QuantitativeValue',maxValue:5,unitCode:'DAY'}},
 shippingRate:{'@type':'MonetaryAmount',value:1200,currency:'KZT'}}
};
const clone=x=>structuredClone(x);
test('observed stock and Kazakhstan shipping stay UNREVIEWED',()=>{
 const r=c.extractTenderOfferSignals_(good);
 assert.equal(r.inventory.reportedQuantity,12);
 assert.equal(r.kazakhstanShipping.maxReportedDeliveryDays,7);
 assert.equal(r.kazakhstanShipping.reportedShippingRate,1200);
 assert.equal(r.stockVerified,false);assert.equal(r.deliveryVerified,false);
 assert.equal(r.deliveryPriceVerified,false);
});
test('no inventory number inferred from InStock',()=>{
 const r=c.extractTenderOfferSignals_({'@type':'Offer',availability:'https://schema.org/InStock'});
 assert.equal(r.inventory,null);
});
test('unknown destination or multiple routes do not claim KZ delivery',()=>{
 const x=clone(good);x.shippingDetails.shippingDestination.addressCountry='RU';
 assert.equal(c.extractTenderOfferSignals_(x).kazakhstanShipping,null);
 const y=clone(good);y.shippingDetails=[good.shippingDetails,good.shippingDetails];
 assert.equal(c.extractTenderOfferSignals_(y).kazakhstanShipping,null);
});
test('ambiguous time units and conditional amounts remain null',()=>{
 const x=clone(good);x.shippingDetails.deliveryTime.transitTime.unitCode='HUR';
 x.shippingDetails.shippingRate.value='1,200';
 const r=c.extractTenderOfferSignals_(x);
 assert.equal(r.kazakhstanShipping.maxReportedDeliveryDays,null);
 assert.equal(r.kazakhstanShipping.reportedShippingRate,null);
});
test('no fractional or negative stock is interpreted as units',()=>{
 for(const value of [-1,'1.5','1,000','1e3',null]){
  const x=clone(good);x.inventoryLevel.value=value;
  assert.equal(c.extractTenderOfferSignals_(x).inventory,null);
 }
});
