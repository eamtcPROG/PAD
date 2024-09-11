# Course: PAD
## Author: Corețchi Mihai FAF-211
## Topic: E-Ticket (Market place for purchasing tickets for events)

## Assess Application Suitability:
People prefer purchasing tickets online for avoiding long queues and immediate access to a broad range of events. Such market place should be distributed systems because:
- The system should handling sudden traffic spikes.
- Selling tickets requires real-time updates on seat availability. Delayed or inaccurate data can lead to overselling tickets or showing tickets as unavailable when they are still on sale.
- Global market access: A centralized system can struggle with regulatory, currency, and latency issues when serving a global user base. A distributed system enables localization features, such as handling various currencies, languages, and compliance with local data regulations like GDPR or CCPA.
    
An example of similar a product is Ticketmaster (https://www.ticketmaster.com/), it handles ticket sales for major events and uses distributed systems to manage the high traffic volume during popular event releases and prevent system overloads. They experienced site crashes when Taylor Swift’s tickets went on sale. To prevent this, they rely on distributed cloud infrastructure to scale up resources automatically.
## Define Service Boundaries:

## Technology Stack and Communication Patterns:

## Design Data Management:

## Deployment and Scaling:
