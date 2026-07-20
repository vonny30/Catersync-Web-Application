// pages/Vehicles.jsx
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Edit, Trash2, X, Truck, Car, Settings } from 'lucide-react';
import { supabase } from '../supabase';

export default function Vehicles() {
  // --- DATA STATE ---
  const [vehicles, setVehicles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // --- MODAL STATES ---
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isManageFleetModalOpen, setIsManageFleetModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // --- FORM STATES ---
  const [newVehicleForm, setNewVehicleForm] = useState({
    plate_number: '',
    vehicle_type: 'Car',
    vehicle_status: 'Available',
  });

  const [editVehicleForm, setEditVehicleForm] = useState({
    vehicle_id: '',
    plate_number: '',
    vehicle_type: 'Car',
    vehicle_status: 'Available',
  });

  const [assignForm, setAssignForm] = useState({
    vehicle_id: '',
    dispatch_datetime: '',
    assignment_status: 'Scheduled',
  });

  // --- FETCH VEHICLES ---
  const fetchVehicles = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('vehicle')
        .select('*')
        .order('plate_number');

      if (error) throw error;
      setVehicles(data || []);
    } catch (error) {
      console.error('Error fetching vehicles:', error);
      alert('Failed to load vehicles. Please refresh.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchVehicles();
  }, []);

  // --- HANDLERS ---
  const handleNewVehicleChange = (e) => {
    const { name, value } = e.target;
    setNewVehicleForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleEditVehicleChange = (e) => {
    const { name, value } = e.target;
    setEditVehicleForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleAssignChange = (e) => {
    const { name, value } = e.target;
    setAssignForm((prev) => ({ ...prev, [name]: value }));
  };

  // --- ADD VEHICLE ---
  const handleAddVehicle = async (e) => {
    e.preventDefault();
    if (!newVehicleForm.plate_number) {
      alert('Plate number is required.');
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('vehicle')
        .insert([{
          plate_number: newVehicleForm.plate_number,
          vehicle_type: newVehicleForm.vehicle_type,
          vehicle_status: 'Available',
        }]);

      if (error) throw error;

      setNewVehicleForm({ plate_number: '', vehicle_type: 'Car', vehicle_status: 'Available' });
      await fetchVehicles();
      alert('Vehicle added successfully!');
    } catch (error) {
      console.error('Error adding vehicle:', error);
      alert(`Failed to add vehicle: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- EDIT VEHICLE ---
  const handleEditClick = (vehicle) => {
    setEditVehicleForm({
      vehicle_id: vehicle.vehicle_id,
      plate_number: vehicle.plate_number,
      vehicle_type: vehicle.vehicle_type,
      vehicle_status: vehicle.vehicle_status,
    });
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editVehicleForm.plate_number) {
      alert('Plate number is required.');
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('vehicle')
        .update({
          plate_number: editVehicleForm.plate_number,
          vehicle_type: editVehicleForm.vehicle_type,
          vehicle_status: editVehicleForm.vehicle_status,
        })
        .eq('vehicle_id', editVehicleForm.vehicle_id);

      if (error) throw error;

      setIsEditModalOpen(false);
      await fetchVehicles();
      alert('Vehicle updated successfully!');
    } catch (error) {
      console.error('Error updating vehicle:', error);
      alert(`Failed to update: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- DELETE VEHICLE ---
  const handleDeleteVehicle = async (vehicleId) => {
    if (!confirm('Delete this vehicle from the fleet? This action cannot be undone.')) return;

    try {
      const { error } = await supabase
        .from('vehicle')
        .delete()
        .eq('vehicle_id', vehicleId);

      if (error) throw error;
      await fetchVehicles();
      alert('Vehicle removed successfully.');
    } catch (error) {
      console.error('Error deleting vehicle:', error);
      alert('Failed to delete vehicle. Make sure it is not assigned to any event.');
    }
  };

  // --- ASSIGN VEHICLE (SIMPLIFIED - will be expanded later) ---
  const handleAssignSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // First, update vehicle status to 'Deployed'
      const { error: vehicleError } = await supabase
        .from('vehicle')
        .update({ vehicle_status: 'Deployed' })
        .eq('vehicle_id', assignForm.vehicle_id);

      if (vehicleError) throw vehicleError;

      // Then create assignment record
      const { error: assignError } = await supabase
        .from('vehicle_assign')
        .insert([{
          vehicle_id: assignForm.vehicle_id,
          dispatch_datetime: assignForm.dispatch_datetime,
          assignment_status: 'Scheduled',
        }]);

      if (assignError) throw assignError;

      setIsAssignModalOpen(false);
      setAssignForm({ vehicle_id: '', dispatch_datetime: '', assignment_status: 'Scheduled' });
      await fetchVehicles();
      alert('Vehicle assigned successfully!');
    } catch (error) {
      console.error('Error assigning vehicle:', error);
      alert(`Failed to assign: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- CALCULATED STATS ---
  const totalCars = vehicles.filter((v) => v.vehicle_type === 'Car').length;
  const totalMotorcycles = vehicles.filter((v) => v.vehicle_type === 'Motorcycle').length;
  const availableCount = vehicles.filter((v) => v.vehicle_status === 'Available').length;
  const deployedCount = vehicles.filter((v) => v.vehicle_status === 'Deployed').length;

  // --- RENDER ---
  return (
    <div className="space-y-6 relative pb-12">
      {/* PAGE HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Vehicles</h1>
          <p className="text-sm text-slate-500">Monitor and manage your fleet.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsManageFleetModalOpen(true)}
            className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 px-4 py-2.5 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-xs cursor-pointer"
          >
            <Settings size={16} /> Manage Fleet
          </button>
          <button
            onClick={() => setIsAssignModalOpen(true)}
            className="bg-[#008A45] hover:bg-[#007038] text-white px-4 py-2.5 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-sm cursor-pointer"
          >
            <Plus size={16} /> Assign Vehicle
          </button>
        </div>
      </div>

      {/* SUMMARY STAT CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-[#CBDEDD]/60 border border-[#b4d2d0] rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-600 mb-1">Total Fleet</p>
          <h3 className="text-3xl font-extrabold text-slate-900">{vehicles.length}</h3>
          <p className="text-xs text-slate-600 mt-2 font-medium">
            {totalCars} cars • {totalMotorcycles} motorcycles
          </p>
        </div>

        <div className="bg-[#CBDEDD]/60 border border-[#b4d2d0] rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-600 mb-1">Available</p>
          <h3 className="text-3xl font-extrabold text-slate-900">{availableCount}</h3>
          <p className="text-xs text-slate-600 mt-2 font-medium">{deployedCount} deployed</p>
        </div>

        <div className="bg-[#CBDEDD]/60 border border-[#b4d2d0] rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-600 mb-1">Vehicle Types</p>
          <h3 className="text-3xl font-extrabold text-slate-900">2</h3>
          <p className="text-xs text-slate-600 mt-2 font-medium">Car • Motorcycle</p>
        </div>
      </div>

      {/* VEHICLE TABLE */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-sm text-slate-800">
          Fleet Inventory
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#EAF3F2] text-slate-800 text-sm border-b border-slate-200">
                <th className="p-4 font-bold">Plate Number</th>
                <th className="p-4 font-bold">Type</th>
                <th className="p-4 font-bold">Status</th>
                <th className="p-4 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan="4" className="p-6 text-center text-slate-400">Loading...</td>
                </tr>
              ) : vehicles.length === 0 ? (
                <tr>
                  <td colSpan="4" className="p-6 text-center text-slate-400 italic">
                    No vehicles in fleet.
                  </td>
                </tr>
              ) : (
                vehicles.map((vehicle) => (
                  <tr key={vehicle.vehicle_id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4 font-bold text-slate-900">{vehicle.plate_number}</td>
                    <td className="p-4">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#CBDEDD]/60 border border-[#a3c7c4] text-slate-800">
                        {vehicle.vehicle_type === 'Car' ? <Car size={14} /> : <Truck size={14} />}
                        {vehicle.vehicle_type}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold 
                        ${vehicle.vehicle_status === 'Available' 
                          ? 'bg-green-50 border border-green-200 text-green-700' 
                          : 'bg-yellow-50 border border-yellow-200 text-yellow-700'}`}
                      >
                        {vehicle.vehicle_status === 'Available' ? '✅' : '🚗'}
                        {vehicle.vehicle_status}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => handleEditClick(vehicle)}
                          className="text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                          title="Edit Vehicle"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => handleDeleteVehicle(vehicle.vehicle_id)}
                          className="text-red-400 hover:text-red-600 transition-colors cursor-pointer"
                          title="Delete Vehicle"
                          disabled={vehicle.vehicle_status === 'Deployed'}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================================================= */}
      {/* 1. MANAGE FLEET MODAL (Add Vehicle) */}
      {/* ========================================================= */}
      {isManageFleetModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Add New Vehicle</h2>
                <p className="text-xs text-slate-500">Add a vehicle to your fleet</p>
              </div>
              <button
                onClick={() => setIsManageFleetModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddVehicle} className="p-6 space-y-5 text-left">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Plate Number *</label>
                <input
                  type="text"
                  name="plate_number"
                  placeholder="e.g. ABC 1234"
                  value={newVehicleForm.plate_number}
                  onChange={handleNewVehicleChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Vehicle Type</label>
                <select
                  name="vehicle_type"
                  value={newVehicleForm.vehicle_type}
                  onChange={handleNewVehicleChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                >
                  <option value="Car">Car</option>
                  <option value="Motorcycle">Motorcycle</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsManageFleetModalOpen(false)}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Adding...' : 'Add Vehicle'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================= */}
      {/* 2. EDIT VEHICLE MODAL */}
      {/* ========================================================= */}
      {isEditModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Edit Vehicle</h2>
                <p className="text-xs text-slate-500">Update vehicle details</p>
              </div>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-6 space-y-5 text-left">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Plate Number *</label>
                <input
                  type="text"
                  name="plate_number"
                  placeholder="e.g. ABC 1234"
                  value={editVehicleForm.plate_number}
                  onChange={handleEditVehicleChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Vehicle Type</label>
                <select
                  name="vehicle_type"
                  value={editVehicleForm.vehicle_type}
                  onChange={handleEditVehicleChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                >
                  <option value="Car">Car</option>
                  <option value="Motorcycle">Motorcycle</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Status</label>
                <select
                  name="vehicle_status"
                  value={editVehicleForm.vehicle_status}
                  onChange={handleEditVehicleChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                >
                  <option value="Available">Available</option>
                  <option value="Deployed">Deployed</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================= */}
      {/* 3. ASSIGN VEHICLE MODAL (Simplified - will be expanded) */}
      {/* ========================================================= */}
      {isAssignModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Assign Vehicle</h2>
                <p className="text-xs text-slate-500">Deploy a vehicle to an event</p>
              </div>
              <button
                onClick={() => setIsAssignModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAssignSubmit} className="p-6 space-y-5 text-left">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Select Vehicle</label>
                <select
                  name="vehicle_id"
                  value={assignForm.vehicle_id}
                  onChange={handleAssignChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white font-semibold text-slate-800 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  required
                >
                  <option value="">-- Choose Vehicle --</option>
                  {vehicles
                    .filter((v) => v.vehicle_status === 'Available')
                    .map((v) => (
                      <option key={v.vehicle_id} value={v.vehicle_id}>
                        {v.plate_number} ({v.vehicle_type})
                      </option>
                    ))}
                  {vehicles.filter((v) => v.vehicle_status === 'Available').length === 0 && (
                    <option disabled>No Available Vehicles</option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Dispatch Date/Time</label>
                <input
                  type="datetime-local"
                  name="dispatch_datetime"
                  value={assignForm.dispatch_datetime}
                  onChange={handleAssignChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-medium text-slate-800 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  required
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsAssignModalOpen(false)}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Assigning...' : 'Assign Vehicle'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}