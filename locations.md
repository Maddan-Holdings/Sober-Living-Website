---
layout: default
title: Locations
---

<!-- Locations page: simple list of addresses -->

---
layout: default
title: "Locations — Sober Living in Bowling Green, KY"
description: "Sober University locations in Bowling Green, KY — 1342 High Street and 1031 Kentucky Street. Call 270-306-4252."
keywords: "sober living locations Bowling Green, sober homes Bowling Green"
---

<!-- Locations page: each address is marked up with schema.org microdata (PostalAddress) -->

# Locations

Our Bowling Green locations (addresses are marked for search engines):

<div itemscope itemtype="https://schema.org/Place">
	<h2 itemprop="name">{{ site.locations[0].name }}</h2>
	<div itemprop="address" itemscope itemtype="https://schema.org/PostalAddress">
		<p>
			<span itemprop="streetAddress">{{ site.locations[0].street }}</span><br>
			<span itemprop="addressLocality">{{ site.locations[0].city }}</span>, <span itemprop="addressRegion">{{ site.locations[0].region }}</span> <span itemprop="postalCode">{{ site.locations[0].postal_code }}</span>
		</p>
		<p><a href="https://www.google.com/maps/search/?api=1&query={{ site.locations[0].street | uri_escape }}+{{ site.locations[0].city | uri_escape }}+{{ site.locations[0].region }}+{{ site.locations[0].postal_code }}" target="_blank" rel="noopener">View on map</a></p>
	</div>
</div>

<div itemscope itemtype="https://schema.org/Place">
	<h2 itemprop="name">{{ site.locations[1].name }}</h2>
	<div itemprop="address" itemscope itemtype="https://schema.org/PostalAddress">
		<p>
			<span itemprop="streetAddress">{{ site.locations[1].street }}</span><br>
			<span itemprop="addressLocality">{{ site.locations[1].city }}</span>, <span itemprop="addressRegion">{{ site.locations[1].region }}</span> <span itemprop="postalCode">{{ site.locations[1].postal_code }}</span>
		</p>
		<p><a href="https://www.google.com/maps/search/?api=1&query={{ site.locations[1].street | uri_escape }}+{{ site.locations[1].city | uri_escape }}+{{ site.locations[1].region }}+{{ site.locations[1].postal_code }}" target="_blank" rel="noopener">View on map</a></p>
	</div>
</div>

Call: **{{ site.phone }}**
