const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Event = sequelize.define(
  "Event",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING,
    },
    date_time: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    venue: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    available_seats: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    total_seats: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    due_date: {
      // New field as integer timestamp
      type: DataTypes.BIGINT, // Use BIGINT to accommodate large timestamp values
      allowNull: true,
      validate: {
        min: 1, // At least 1 millisecond before
      },
    },
  },
  {
    freezeTableName: true,
  }
);

module.exports = Event;
